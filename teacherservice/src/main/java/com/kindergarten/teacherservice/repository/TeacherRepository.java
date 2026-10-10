package com.kindergarten.teacherservice.repository;

import com.kindergarten.teacherservice.model.Teacher;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.data.mongodb.repository.Update;

@Repository
public interface TeacherRepository extends MongoRepository<Teacher, String> {
    @Query("{ '_id': ?0, 'recordId': null }")
    @Update("{ '$set': { 'recordId': ?1 } }")
    void assignRecordId(String id, String recordId);
}
