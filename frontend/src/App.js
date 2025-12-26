// src/App.js
import React, { useState, useEffect } from "react";
import StudentForm from "./components/StudentForm";
import StudentList from "./components/StudentList";
import TeacherForm from "./components/TeacherForm";
import TeacherList from "./components/TeacherList";
import EmployeeForm from "./components/EmployeeForm";
import EmployeeList from "./components/EmployeeList";
import "./App.css";
// import { init as initApm } from '@elastic/apm-rum'

// // APM initialization (optional)
// const apm = initApm({
//   serviceName: 'kindergarten-frontend',
//   serverUrl: 'http://192.168.121.224:8200',
//   serviceVersion: '1.0.0',
//   environment: 'development'
// })

function App() {
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [activeTab, setActiveTab] = useState("students");

  // Service health status
  const [serviceStatus, setServiceStatus] = useState({
    student: false,
    teacher: false,
    employee: false,
  });

  // API Base URLs
  const STUDENT_SERVICE_URL = "http://localhost:5001";
  const TEACHER_SERVICE_URL = "http://localhost:5002";
  const EMPLOYEE_SERVICE_URL = "http://localhost:5003";

  // ---------- Health Check ----------
  const checkService = async (url, key) => {
    try {
      const res = await fetch(url, { method: "GET" });
      setServiceStatus((prev) => ({
        ...prev,
        [key]: res.ok,
      }));
    } catch (err) {
      setServiceStatus((prev) => ({
        ...prev,
        [key]: false,
      }));
    }
  };

  // ---------- Fetch Data ----------
  const fetchStudents = () => {
    fetch(`${STUDENT_SERVICE_URL}/students`)
      .then((res) => res.json())
      .then((data) => setStudents(data || []))
      .catch((err) => console.error("Fetch students error:", err));
  };

  const fetchTeachers = () => {
    fetch(`${TEACHER_SERVICE_URL}/teachers`)
      .then((res) => res.json())
      .then((data) => setTeachers(data || []))
      .catch((err) => console.error("Fetch teachers error:", err));
  };

  const fetchEmployees = () => {
    fetch(`${EMPLOYEE_SERVICE_URL}/employees`)
      .then((res) => res.json())
      .then((data) => setEmployees(data || []))
      .catch((err) => console.error("Fetch employees error:", err));
  };

  useEffect(() => {
    fetchStudents();
    fetchTeachers();
    fetchEmployees();

    // Initial health check
    checkService(`${STUDENT_SERVICE_URL}/students`, "student");
    checkService(`${TEACHER_SERVICE_URL}/teachers`, "teacher");
    checkService(`${EMPLOYEE_SERVICE_URL}/employees`, "employee");

    // Re-check every 10 seconds
    const interval = setInterval(() => {
      checkService(`${STUDENT_SERVICE_URL}/students`, "student");
      checkService(`${TEACHER_SERVICE_URL}/teachers`, "teacher");
      checkService(`${EMPLOYEE_SERVICE_URL}/employees`, "employee");
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // ---------- Add ----------
  const addStudent = async (student) => {
    await fetch(`${STUDENT_SERVICE_URL}/add-student`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(student),
    });
    fetchStudents();
  };

  const addTeacher = async (teacher) => {
    await fetch(`${TEACHER_SERVICE_URL}/add-teacher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(teacher),
    });
    fetchTeachers();
  };

  const addEmployee = async (employee) => {
    await fetch(`${EMPLOYEE_SERVICE_URL}/add-employee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(employee),
    });
    fetchEmployees();
  };

  // ---------- Delete ----------
  const handleDeleteStudent = async (roll) => {
    if (window.confirm("Delete this student?")) {
      await fetch(`${STUDENT_SERVICE_URL}/delete-student?roll=${roll}`, {
        method: "DELETE",
      });
      fetchStudents();
    }
  };

  const handleDeleteTeacher = async (id) => {
    if (window.confirm("Delete this teacher?")) {
      await fetch(`${TEACHER_SERVICE_URL}/delete-teacher?id=${id}`, {
        method: "DELETE",
      });
      fetchTeachers();
    }
  };

  const handleDeleteEmployee = async (id) => {
    if (window.confirm("Delete this employee?")) {
      await fetch(`${EMPLOYEE_SERVICE_URL}/delete-employee?id=${id}`, {
        method: "DELETE",
      });
      fetchEmployees();
    }
  };

  // ---------- Edit ----------
  const handleEditStudent = async (student) => {
    await fetch(`${STUDENT_SERVICE_URL}/update-student`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(student),
    });
    fetchStudents();
  };

  const handleEditTeacher = async (teacher) => {
    await fetch(`${TEACHER_SERVICE_URL}/update-teacher`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(teacher),
    });
    fetchTeachers();
  };

  const handleEditEmployee = async (employee) => {
    await fetch(`${EMPLOYEE_SERVICE_URL}/update-employee`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(employee),
    });
    fetchEmployees();
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Kindergarten School Registry</h1>

      {/* Service Status */}
      <div style={{ marginBottom: 20, fontSize: 14 }}>
        <strong>Services:</strong>

        <span
          style={{
            marginLeft: 10,
            color: serviceStatus.student ? "#28a745" : "#dc3545",
          }}
        >
          ● Student (golang)
        </span>

        <span
          style={{
            marginLeft: 10,
            color: serviceStatus.teacher ? "#28a745" : "#dc3545",
          }}
        >
          ● Teacher (java)
        </span>

        <span
          style={{
            marginLeft: 10,
            color: serviceStatus.employee ? "#28a745" : "#dc3545",
          }}
        >
          ● Employee (python)
        </span>
      </div>

      {/* Tabs */}
      <div className="tab-navigation">
        <button
          className={`tab-button ${activeTab === "students" ? "active" : ""}`}
          onClick={() => setActiveTab("students")}
          disabled={!serviceStatus.student}
        >
          Students
        </button>

        <button
          className={`tab-button ${activeTab === "teachers" ? "active" : ""}`}
          onClick={() => setActiveTab("teachers")}
          disabled={!serviceStatus.teacher}
        >
          Teachers
        </button>

        <button
          className={`tab-button ${activeTab === "employees" ? "active" : ""}`}
          onClick={() => setActiveTab("employees")}
          disabled={!serviceStatus.employee}
        >
          Employees
        </button>
      </div>

      {/* Content */}
      <div className="tab-content">
        {activeTab === "students" && serviceStatus.student && (
          <>
            <StudentForm onAddStudent={addStudent} />
            <StudentList
              students={students}
              onDelete={handleDeleteStudent}
              onEdit={handleEditStudent}
            />
          </>
        )}

        {activeTab === "teachers" && serviceStatus.teacher && (
          <>
            <TeacherForm onAddTeacher={addTeacher} />
            <TeacherList
              teachers={teachers}
              onDelete={handleDeleteTeacher}
              onEdit={handleEditTeacher}
            />
          </>
        )}

        {activeTab === "employees" && serviceStatus.employee && (
          <>
            <EmployeeForm onAddEmployee={addEmployee} />
            <EmployeeList
              employees={employees}
              onDelete={handleDeleteEmployee}
              onEdit={handleEditEmployee}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default App;
