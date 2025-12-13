# Local File Explorer Server

A simple web-based file explorer server for browsing and managing files on your local machine or PC through a web interface.

## Requirements

- **Python 3.5+** (Python 3.6 or higher recommended)
- No additional packages required - uses only the Python standard library

## Setup

1. **Ensure Python is installed** on your system:
   ```bash
   python --version
   # or
   python3 --version
   ```

2. **Verify the project structure**:
   ```
   your-directory/
   ├── local_file_explorer_server.py
   ├── assets/
   │   ├── index.html
   │   ├── style.css
   │   ├── script.js
   │   └── [other asset files]
   └── README.md
   ```

## How to Run

1. **Navigate to the directory** containing `local_file_explorer_server.py`:
   ```bash
   cd ""C:\Users\Username\Downloads""
   # or your path to the script
   ```

2. **Run the Python script**:
   ```bash
   python local_file_explorer_server.py
   # or
   python3 local_file_explorer_server.py
   ```

3. **Access the web interface**:
   - Open your web browser
   - Navigate to: `http://localhost:1313`
   - Or from another device on your network: `http://YOUR_IP_ADDRESS:1313`

4. **Stop the server**:
   - Press `Ctrl+C` in the terminal where the server is running

## Configuration

### Changing the Port

To change the server port, edit `local_file_explorer_server.py` and modify line 358:

```python
server = HTTPServer(("0.0.0.0", 1313), UploadHandler)
```

Replace `1313` with your desired port number (e.g., `8000`, `8080`, etc.).

### Changing the Upload Directory

The upload directory is set to `uploads` by default. To change it, modify line 13 in `local_file_explorer_server.py`:

```python
UPLOAD_DIR = "uploads"  # Change to your desired directory name
```

## Notes

- The server binds to `0.0.0.0`, making it accessible from other devices on your network
- **Do not expose this server to the internet** without proper security measures
- The `uploads` directory is created automatically when the server starts
