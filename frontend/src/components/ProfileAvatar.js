import React from "react";
import Photo from "./Photo";

export default function ProfileAvatar({ onNotice }) {
  return <Photo kind="school" recordId="admin" name="School profile" initials="K" onNotice={onNotice} />;
}
