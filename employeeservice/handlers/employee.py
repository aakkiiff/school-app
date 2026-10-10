from flask import request, jsonify, g
from pymongo.errors import PyMongoError

from database.db import get_collection


def get_employees():
    try:
        collection = get_collection("employees")
        employees = list(collection.find({}))
        for employee in employees:
            employee["recordId"] = str(employee.pop("_id"))
        return jsonify(employees), 200

    except Exception as e:
        g.error_type = type(e).__name__
        return jsonify({"error": str(e)}), 500



def add_employee():
    if request.method == "OPTIONS":
        return "", 200

    try:
        employee = request.get_json()

        if not employee:
            return jsonify({"error": "Invalid input"}), 400

        required_fields = ["id", "name", "position"]
        for field in required_fields:
            if field not in employee or not employee[field]:
                return jsonify({"error": f"Missing field: {field}"}), 400

        collection = get_collection("employees")

        if collection.find_one({"id": employee["id"]}):
            return jsonify({"error": "Employee with this ID already exists"}), 409

        employee = {field: employee[field] for field in required_fields}
        result = collection.insert_one(dict(employee))
        employee["recordId"] = str(result.inserted_id)
        return jsonify(employee), 201

    except Exception as e:
        g.error_type = type(e).__name__
        return jsonify({"error": str(e)}), 500


def delete_employee():
    emp_id = request.args.get("id")
    if not emp_id:
        return jsonify({"error": "ID parameter missing"}), 400

    try:
        collection = get_collection("employees")
        result = collection.delete_one({"id": emp_id})

        if result.deleted_count == 0:
            return jsonify({"error": "Employee not found"}), 404

        return jsonify({"message": "Employee deleted successfully"}), 200

    except Exception as e:
        g.error_type = type(e).__name__
        return jsonify({"error": str(e)}), 500


def update_employee():
    updated = request.get_json()
    if not updated:
        return jsonify({"error": "Invalid input"}), 400

    try:
        collection = get_collection("employees")
        result = collection.update_one(
            {"id": updated["id"]},
            {"$set": {field: updated[field] for field in ["name", "position"]}},
        )

        if result.matched_count == 0:
            return jsonify({"error": "Employee not found"}), 404

        saved = collection.find_one({"id": updated["id"]})
        saved["recordId"] = str(saved.pop("_id"))
        return jsonify(saved), 200

    except Exception as e:
        g.error_type = type(e).__name__
        return jsonify({"error": str(e)}), 500
