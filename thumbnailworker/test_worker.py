import io
import unittest
from unittest.mock import Mock

from PIL import Image

from worker import MAX_BYTES, process_event, thumbnail


def photo(size=(400, 200), color="red", **save_args):
    output = io.BytesIO()
    Image.new("RGB", size, color).save(output, "PNG", **save_args)
    return output.getvalue()


class ThumbnailTests(unittest.TestCase):
    def test_square_webp_preserves_aspect_ratio_with_padding(self):
        with Image.open(io.BytesIO(thumbnail(photo()))) as image:
            self.assertEqual(image.size, (256, 256))
            self.assertEqual(image.format, "WEBP")
            self.assertGreater(image.getpixel((128, 128))[0], 240)
            self.assertLess(image.getpixel((128, 128))[1], 15)
            self.assertGreater(image.getpixel((128, 1))[1], 220)
            self.assertNotIn("exif", image.info)

    def test_corrupt_image_rejected(self):
        with self.assertRaises(Exception):
            thumbnail(b"not an image")

    def test_size_limit(self):
        with self.assertRaises(ValueError):
            thumbnail(b"x" * (MAX_BYTES + 1))

    def test_pixel_limit(self):
        with self.assertRaises((ValueError, Image.DecompressionBombWarning)):
            thumbnail(photo((5000, 4001)))

    def test_exif_orientation_and_metadata_removed(self):
        output = io.BytesIO()
        exif = Image.Exif()
        exif[274] = 6
        exif[270] = "private metadata"
        Image.new("RGB", (400, 200), "red").save(output, "JPEG", exif=exif)
        with Image.open(io.BytesIO(thumbnail(output.getvalue()))) as image:
            self.assertEqual(image.size, (256, 256))
            self.assertGreater(image.getpixel((1, 128))[1], 220)
            self.assertLess(image.getpixel((128, 1))[1], 15)
            self.assertEqual(len(image.getexif()), 0)


class JobTests(unittest.TestCase):
    def setUp(self):
        self.job = {"version": "v1", "sourceKey": "original", "thumbnailKey": "thumb",
                    "state": "queued", "attempts": 0}
        self.doc = {"_id": "students/id", "desired": "v1", "deleted": False, "jobs": [self.job]}
        self.owners = Mock()
        self.owners.find_one.return_value = self.doc
        self.owners.update_one.return_value = Mock(modified_count=1)
        self.s3 = Mock()
        self.s3.get_object.return_value = {"Body": io.BytesIO(photo())}
        self.event = {"schemaVersion": 1, "type": "image.uploaded", "owner": "students/id",
                      "version": "v1", "sourceBucket": "originals", "sourceKey": "original",
                      "thumbnailBucket": "thumbnails", "thumbnailKey": "thumb"}

    def run_job(self):
        return process_event(self.event, self.owners, self.s3, "originals", "thumbnails")

    def test_ready_written_after_object_upload(self):
        self.assertEqual(self.run_job(), "ready")
        self.s3.put_object.assert_called_once()
        update = self.owners.update_one.call_args.args[1]["$set"]
        self.assertEqual(update["jobs.$.state"], "ready")
        self.assertEqual(update["current"]["version"], "v1")

    def test_duplicate_and_stale_do_not_write(self):
        self.job["state"] = "ready"
        self.assertEqual(self.run_job(), "duplicate")
        self.doc["desired"] = "v2"
        self.assertEqual(self.run_job(), "stale")
        self.s3.get_object.assert_not_called()

    def test_superseded_worker_cannot_promote_old_thumbnail(self):
        self.owners.update_one.side_effect = [Mock(modified_count=1), Mock(modified_count=0), Mock()]
        self.assertEqual(self.run_job(), "stale")
        self.s3.delete_object.assert_called_once_with(Bucket="thumbnails", Key="thumb")

    def test_transient_failure_schedules_retry(self):
        self.s3.get_object.side_effect = OSError("storage down")
        self.assertEqual(self.run_job(), "retry")
        self.assertEqual(self.owners.update_one.call_args.args[1]["$set"]["jobs.$.state"], "pending")

    def test_third_failure_is_terminal(self):
        self.job["attempts"] = 2
        self.s3.get_object.side_effect = OSError("storage down")
        self.assertEqual(self.run_job(), "failed")
        self.assertEqual(self.owners.update_one.call_args.args[1]["$set"]["jobs.$.state"], "failed")

    def test_message_cannot_change_bucket_or_key(self):
        self.event["sourceKey"] = "other-key"
        with self.assertRaises(ValueError):
            self.run_job()
        self.s3.get_object.assert_not_called()


if __name__ == "__main__":
    unittest.main()
