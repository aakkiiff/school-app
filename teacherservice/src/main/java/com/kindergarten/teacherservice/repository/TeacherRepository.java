package com.kindergarten.teacherservice.repository;

import com.kindergarten.teacherservice.model.Teacher;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface TeacherRepository extends MongoRepository<Teacher, String> {
    // MongoRepository already provides all required CRUD methods
}
