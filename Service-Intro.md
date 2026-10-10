# School Application

A small school registry app for managing students, teachers, employees, and
their photos. Docker Compose runs the web app and all supporting services.

## Table of contents

- [Services](#services)
- [How the services communicate](#how-the-services-communicate)
- [Run the project](#run-the-project)
- [Useful addresses](#useful-addresses)

## Services

| Service | What it does and how | Why it is needed | Communicates with |
| --- | --- | --- | --- |
| **Frontend** | Shows the school dashboard in a web browser. It is a React app served as static files. | Gives users a place to view and manage school records and photos. | Nginx, which forwards its API requests to the right backend. |
| **Nginx** | Acts as the front door: sends web pages to the frontend, API requests to the matching API, and photo downloads to object storage. | Gives the browser one address for the whole application. | Frontend, Student, Teacher, Employee, and Profile services; Object storage for photo downloads. |
| **Student service** | A Go API that adds, lists, updates, and deletes student records in MongoDB. | Handles student data. | MongoDB. Browser requests reach it through Nginx. |
| **Teacher service** | A Java/Spring API that adds, lists, updates, and deletes teacher records in MongoDB. | Handles teacher data. | MongoDB. Browser requests reach it through Nginx. |
| **Employee service** | A Python/Flask API that adds, lists, updates, and deletes employee records in MongoDB. | Handles employee data. | MongoDB. Browser requests reach it through Nginx. |
| **Profile service** | A Node.js API that accepts photos, tracks their status, stores originals, and queues thumbnail work. | Manages photos for school records and the shared school avatar without making uploads wait for thumbnail processing. | MongoDB, RabbitMQ, and Object storage. The browser reaches it through Nginx. |
| **Thumbnail worker** | A Python background service that reads queued photo jobs, makes small WebP thumbnails, and saves them. | Keeps image processing separate from web requests, so uploads can finish quickly. | RabbitMQ for jobs, MongoDB for job status, and Object storage for image files. |
| **MongoDB** | Stores records and media-processing status in the `kindergarten` database. | Keeps application data between restarts. | Student, Teacher, Employee, and Profile services; Thumbnail worker; Mongo Express. |
| **Mongo Express** | A browser-based dashboard for viewing MongoDB data. | Makes it easier to inspect the database while learning or developing. | MongoDB. |
| **RabbitMQ** | Holds photo-processing jobs in a queue until a worker can process them. | Lets photo uploads and thumbnail creation happen at different times and recover from temporary failures. | Profile service publishes jobs; Thumbnail worker consumes them. |
| **Object storage (RustFS)** | Stores original photos and generated thumbnails in separate buckets. | Keeps image files out of MongoDB while supporting private, signed photo links. | Profile service and Thumbnail worker; Nginx forwards browser photo downloads. |

## How the services communicate

1. The browser loads the **Frontend** through **Nginx**.
2. When a user manages a student, teacher, or employee, the browser sends a
   request through Nginx to that type's API. The API reads or writes its records
   in **MongoDB**.
3. When a user uploads a photo, the **Profile service** saves the original in
   **Object storage** and records its status in MongoDB.
4. The Profile service puts a thumbnail job on **RabbitMQ**. The **Thumbnail
   worker** picks it up, creates the thumbnail, saves it in Object storage, and
   updates its status in MongoDB.
5. The browser checks the Profile service for photo status. When a thumbnail is
   ready, Nginx forwards the browser's photo request to Object storage.
6. **Mongo Express** is an optional dashboard for inspecting MongoDB; it is not
   part of the normal request flow.

The three registry APIs and the Profile service use separate MongoDB collections
in the same database. The Profile service checks those collections to make sure
a photo belongs to an existing school record.

