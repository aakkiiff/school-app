package com.kindergarten.teacherservice.service;

import com.kindergarten.teacherservice.model.Teacher;
import com.kindergarten.teacherservice.repository.TeacherRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TeacherService {

    private final TeacherRepository teacherRepository;

    // Constructor injection (best practice)
    public TeacherService(TeacherRepository teacherRepository) {
        this.teacherRepository = teacherRepository;
    }

    // Get all teachers
    public List<Teacher> getAllTeachers() {
        List<Teacher> teachers = teacherRepository.findAll();
        for (Teacher teacher : teachers) {
            if (teacher.getRecordId() == null) {
                teacherRepository.assignRecordId(teacher.getId(), UUID.randomUUID().toString());
                teacher.setRecordId(teacherRepository.findById(teacher.getId()).orElseThrow().getRecordId());
            }
        }
        return teachers;
    }

    // Add new teacher
    public Teacher addTeacher(Teacher teacher) {
        if (teacher.getId() != null && teacherRepository.existsById(teacher.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Teacher with this ID already exists");
        }
        teacher.setRecordId(UUID.randomUUID().toString());
        return teacherRepository.insert(teacher);
    }

    // Update teacher by MongoDB id
    public Teacher updateTeacher(String id, Teacher updatedTeacher) {
        Teacher existing = teacherRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Teacher not found"));

        existing.setName(updatedTeacher.getName());
        existing.setSubject(updatedTeacher.getSubject());

        return teacherRepository.save(existing);
    }

    // Delete teacher by MongoDB id
    public void deleteTeacher(String id) {
        if (!teacherRepository.existsById(id)) {
            throw new RuntimeException("Teacher not found");
        }
        teacherRepository.deleteById(id);
    }

    // Get teacher by MongoDB id
    public Optional<Teacher> getTeacherById(String id) {
        return teacherRepository.findById(id);
    }
}
