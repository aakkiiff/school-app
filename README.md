
# Kindergarten Project – Run Locally

**Objective:** Run all services (Student, Teacher, Employee) and the frontend locally. Verify that the system works.

----------

## **Step 1: Prepare MongoDB**

1.  Decide whether to run **MongoDB locally** or via **Docker**.
    
2.  **Local installation:**
    
    -   Download the latest MongoDB from the official website.
        
    -   Install and start the MongoDB service.
        
    -   Make sure it runs on the default port `27017`.
        
3.  **Docker option:**
    
    -   Pull the latest MongoDB image.
        
    -   Run a MongoDB container.
        
    -   Ensure it is accessible on port `27017`.
        

> **Goal:** other services should be able to connect to MongoDB before starting any backend.




## **Step 2: Run Employee Service (Python)**

**Objective:** Start the Python backend service so the frontend can communicate with it.

----------

### **Requirements**

-   Must have **Python 3** installed on your machine.
    
-   MongoDB should be running (from Step 1).
    

----------

### **Instructions**

1.  **Navigate to the Employee Service folder**
    
    -   Open your terminal and go to the `employeeservice` directory.
        
2.  **Create a virtual environment** _(only needed if running locally, not in Docker)_
    

-   `python3 -m venv venv` 
    
-   **Activate the virtual environment**
    
    -   **Linux/macOS:**

-   `source venv/bin/activate` 
    
-   **Install dependencies**
    
-   `pip install -r requirements.txt` 
    
-   **Set required environment variables**
    

`export MONGODB_URI="mongodb://myUser:myPassword@mongo:27017/kindergarten?authSource=admin"` 
`export DATABASE_NAME="kindergarten"` 
 
-   **Run the Python application**
    

1.  `python3 app.py` 
    
2.  **Verify the service is running**
    
    -   The terminal should show that the backend is listening on a port ( `5003`).

       
----------



## **Step 3: Run Frontend (React)**

**Objective:** Start the React frontend and verify that it can communicate with all backend services (Student, Teacher, Employee).

----------

### **Requirements**

-   Node.js and npm installed on your machine.
    
-   All backend services (Student, Teacher, Employee) running from previous steps.
    

----------

### **Instructions**

1.  **Navigate to the frontend folder**
    
    -   Open your terminal and go to the `frontend` directory.
        
2.  **Install dependencies**
    

-   `npm install` 
    
-   **Start the frontend application**
    

1.  `npm start` 
    
    -   This will start the frontend server, usually on `http://localhost:3000` (or Vite default port if using Vite: `5173`).
        
2.  **Verify communication with backend services**
    
    -   Open the frontend in a browser.
        
    -   Go to the **Employee, Teacher, and Student tabs**.
        
    -   Make sure the frontend is able to fetch and display data from each backend.
        
3.  **Check the URLs used by the frontend**
    
    -   Verify that the **Employee service URL** matches your local backend URL (for example, `http://localhost:5003`).
        
    -   If needed, adjust the frontend configuration so that it points to the correct backend URLs.
        

----------

> ✅ **Checkpoint:**
> 
> -   Frontend loads successfully.
>     
> -   Each tab fetches data correctly from the corresponding backend service.
>     
> -   Green/red status indicators (if implemented) show the service health.
>     

----------

----------

## **Step 4: Run Student Service (Go)**

**Objective:** Start the Go backend for the Student service so the frontend can fetch student data.

----------

### **Requirements**

-   Latest **Go** installed on your machine.
    
-   MongoDB running (from Step 1).
    

----------

### **Instructions**

1.  **Navigate to the Student Service folder**
    
    -   Open your terminal and go to the `studentservice` directory.
        
2.  **Install dependencies**
    

-   `go mod tidy` 
    
    -   This will download and install all required Go modules.
        
-   **Set required environment variables**
    

-   `export MONGODB_URI="mongodb://myUser:myPassword@172.22.0.2:27017/kindergarten?authSource=admin"  export DATABASE_NAME="kindergarten"` 
    
-   **Run the Go application**
    

-   `go run main.go` 
    
    -   The backend should start and listen on a port ( `5001`).
        
-   **Verify service availability**
    
    -   Open the frontend in a browser.
        
    -   Go to the **Student tab**.
        
    -   Confirm that the frontend can fetch and display student data.

## **Step 5: Run Teacher Service (Java)**

**Objective:** Start the Java backend for the Teacher service so the frontend can fetch teacher data.

----------

### **Requirements**

-   Java (OpenJDK 17) installed.
    
-   Maven installed.
    
-   MongoDB running (from Step 1).
    

----------

### **Instructions**

1.  **Update system packages**
    

-   `sudo apt update` 
    
-   **Install Java runtime**
    

-   `sudo apt install openjdk-17-jre
    java -version` 
    
    -   Ensure Java 17 or higher is installed.
        
-   **Install Maven**
    

-   `sudo apt install maven` 
    
-   **Navigate to the Teacher Service folder**
    
    -   Open your terminal and go to the `teacherservice` directory.
        
-   **Build the project using Maven**
    

-   `mvn clean package` 
    
    -   This will create a `.jar` file in the `target` folder.
        
-   **Run the Java application**
    

1.  `java -jar target/<jar-file-name>.jar` 
    
    -   Replace `<jar-file-name>` with the actual name of the `.jar` generated by Maven.
        
    -   The backend should start and listen on a port ( `5002`).
        
2.  **Verify service availability**
    
    -   Open the frontend in a browser.
        
    -   Go to the **Teacher tab**.
        
    -   Confirm that the frontend can fetch and display teacher data.
        

----------

> ✅ **Checkpoint:**
> 
> -   Teacher service runs successfully.
>     
> -   Frontend is able to communicate with the Teacher backend using the correct URL.
>     

----------
# school-application
