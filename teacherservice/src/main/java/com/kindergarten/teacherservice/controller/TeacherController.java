package com.kindergarten.teacherservice.controller;

import com.kindergarten.teacherservice.model.Teacher;
import com.kindergarten.teacherservice.service.TeacherService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@CrossOrigin(origins = "*")
public class TeacherController {
    
    @Autowired
    private TeacherService teacherService;
    
    // GET all teachers - matches frontend GET /teachers
    @GetMapping("/teachers")
    public ResponseEntity<List<Teacher>> getAllTeachers() {
        List<Teacher> teachers = teacherService.getAllTeachers();
        return ResponseEntity.ok(teachers);
    }
    
    // POST add teacher - matches frontend POST /add-teacher
    @PostMapping("/add-teacher")
    public ResponseEntity<?> addTeacher(@RequestBody Teacher teacher) {
        try {
            Teacher savedTeacher = teacherService.addTeacher(teacher);
            return ResponseEntity.status(HttpStatus.CREATED).body(savedTeacher);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
        }
    }
    
    // PUT update teacher - matches frontend PUT /update-teacher
    @PutMapping("/update-teacher")
    public ResponseEntity<?> updateTeacher(@RequestBody Teacher teacher) {
        try {
            Teacher updatedTeacher =
                teacherService.updateTeacher(teacher.getId(), teacher);
            return ResponseEntity.ok(updatedTeacher);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    
    // DELETE teacher - matches frontend DELETE /delete-teacher
    @DeleteMapping("/delete-teacher")
    public ResponseEntity<?> deleteTeacher(@RequestParam String id) {
        try {
            teacherService.deleteTeacher(id);
            return ResponseEntity.ok().body(Map.of("message", "Teacher deleted successfully"));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        }
    }
    
    // Additional endpoint for getting teacher by ID
    @GetMapping("/teachers/{id}")
    public ResponseEntity<Teacher> getTeacher(@PathVariable String id) {
        Optional<Teacher> teacher = teacherService.getTeacherById(id);
        return teacher.map(ResponseEntity::ok)
                     .orElse(ResponseEntity.notFound().build());
    }
}