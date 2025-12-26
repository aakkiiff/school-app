import logging
from flask import Flask
from flask_cors import CORS

from database.db import connect_db
from handlers.employee import (
    add_employee,
    get_employees,
    delete_employee,
    update_employee,
)

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)

connect_db()
logging.info("Employee Service initialized successfully")


@app.route("/add-employee", methods=["POST", "OPTIONS"])
def add_employee_route():
    return add_employee()


@app.route("/employees", methods=["GET", "OPTIONS"])
def get_employees_route():
    return get_employees()


@app.route("/delete-employee", methods=["DELETE", "OPTIONS"])
def delete_employee_route():
    return delete_employee()


@app.route("/update-employee", methods=["PUT", "OPTIONS"])
def update_employee_route():
    return update_employee()


if __name__ == "__main__":
    logging.info("Employee Service running on port 5003")
    app.run(host="0.0.0.0", port=5003)
