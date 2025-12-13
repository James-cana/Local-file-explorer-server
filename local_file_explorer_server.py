from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
import re
import json
import urllib.parse
import stat
import zipfile
import io
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def is_hidden(path):
    """Check if a file or directory is hidden.
    On Windows, checks the FILE_ATTRIBUTE_HIDDEN attribute.
    On Unix-like systems, checks if the name starts with '.'.
    """
    if os.path.basename(path).startswith('.'):
        return True
    
    try:
        file_stat = os.stat(path)
        if hasattr(file_stat, 'st_file_attributes'):
            if file_stat.st_file_attributes & stat.FILE_ATTRIBUTE_HIDDEN:
                return True
    except (OSError, AttributeError):
        pass
    
    return False

def get_folder_size(folder_path):
    """Calculate the total size of a folder recursively.
    Returns the size in bytes.
    """
    total_size = 0
    try:
        for dirpath, dirnames, filenames in os.walk(folder_path):
            # Filter out hidden directories and 'uploads' folder
            dirnames[:] = [d for d in dirnames if not is_hidden(os.path.join(dirpath, d)) and d != 'uploads']
            
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                try:
                    if not is_hidden(filepath):
                        total_size += os.path.getsize(filepath)
                except (OSError, ValueError):
                    # Skip files that can't be accessed
                    continue
    except (OSError, PermissionError):
        # Return 0 if folder can't be accessed
        pass
    
    return total_size

class UploadHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Route GET requests: file listing API, file downloads, index page, or static assets
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        
        if path == '/api/files' or path == '/api/files/':
            self.send_file_list()
        elif path.startswith('/download/'):
            self.send_file()
        elif path == '/' or path == '/index.html' or path == '':
            self.serve_index()
        else:
            self.serve_static()
    
    def serve_index(self):
        # Serve the main HTML page and inject server root directory path for client-side use
        try:
            with open('assets/index.html', 'r', encoding='utf-8') as f:
                content = f.read()
            content = content.replace(
                '<script src="assets/script.js"></script>',
                f'<script>window.SERVER_ROOT_DIR = {json.dumps(SCRIPT_DIR)};</script>\n  <script src="assets/script.js"></script>'
            )
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(content.encode('utf-8'))
        except FileNotFoundError:
            self.send_error(404, "File not found")
    
    def serve_static(self):
        filepath = urllib.parse.unquote(self.path[1:])
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            self.send_error(404, "File not found")
            return
        
        try:
            with open(filepath, 'rb') as f:
                content = f.read()
            self.send_response(200)
            content_type = 'application/octet-stream'
            if filepath.endswith('.html'):
                content_type = 'text/html; charset=utf-8'
            elif filepath.endswith('.css'):
                content_type = 'text/css; charset=utf-8'
            elif filepath.endswith('.js'):
                content_type = 'application/javascript; charset=utf-8'
            elif filepath.endswith('.json'):
                content_type = 'application/json; charset=utf-8'
            elif filepath.endswith('.png'):
                content_type = 'image/png'
            elif filepath.endswith('.jpg') or filepath.endswith('.jpeg'):
                content_type = 'image/jpeg'
            elif filepath.endswith('.gif'):
                content_type = 'image/gif'
            elif filepath.endswith('.ico'):
                content_type = 'image/x-icon'
            elif filepath.endswith('.flac'):
                content_type = 'audio/flac'
            elif filepath.endswith('.svg'):
                content_type = 'image/svg+xml'
            
            self.send_header('Content-type', content_type)
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error: {str(e)}")
    
    def send_file_list(self):
        # API endpoint: Returns file/folder listing as JSON
        # If 'folder' query param provided: returns immediate children of that folder
        # Otherwise: returns all files recursively (backward compatibility)
        try:
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            folder_path = query_params.get('folder', [None])[0]
            
            if folder_path is not None:
                folder_path = urllib.parse.unquote(folder_path)
                if folder_path == '.' or folder_path == '':
                    folder_path = '.'
                else:
                    folder_path = os.path.normpath(folder_path)
                
                # Security: Prevent directory traversal attacks by ensuring path stays within server root
                abs_folder_path = os.path.abspath(folder_path)
                server_root = SCRIPT_DIR
                try:
                    os.path.relpath(abs_folder_path, server_root)
                    if not abs_folder_path.startswith(server_root):
                        self.send_response(403)
                        self.send_header('Content-type', 'application/json')
                        self.end_headers()
                        error_response = json.dumps({'error': 'Invalid folder path'})
                        self.wfile.write(error_response.encode())
                        return
                except ValueError:
                    self.send_response(403)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    error_response = json.dumps({'error': 'Invalid folder path'})
                    self.wfile.write(error_response.encode())
                    return
                
                if not os.path.exists(folder_path) or not os.path.isdir(folder_path):
                    self.send_response(404)
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    error_response = json.dumps({'error': 'Folder not found'})
                    self.wfile.write(error_response.encode())
                    return
                
                items = []
                try:
                    for item in os.listdir(folder_path):
                        item_path = os.path.join(folder_path, item)
                        
                        if is_hidden(item_path) or item == 'uploads':
                            continue
                        
                        rel_path = os.path.relpath(item_path, '.').replace('\\', '/')
                        
                        if os.path.isdir(item_path):
                            try:
                                folder_size = get_folder_size(item_path)
                                items.append({
                                    'path': rel_path,
                                    'name': item,
                                    'type': 'folder',
                                    'size': folder_size
                                })
                            except (OSError, PermissionError):
                                # If we can't calculate size, still add folder with 0 size
                                items.append({
                                    'path': rel_path,
                                    'name': item,
                                    'type': 'folder',
                                    'size': 0
                                })
                        elif os.path.isfile(item_path):
                            try:
                                file_size = os.path.getsize(item_path)
                                items.append({
                                    'path': rel_path,
                                    'name': item,
                                    'type': 'file',
                                    'size': file_size
                                })
                            except (OSError, ValueError):
                                continue
                except (OSError, PermissionError):
                    pass
                
                items.sort(key=lambda x: (x['type'] != 'folder', x['name'].lower()))
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(items).encode())
                return
            
            # Backward compatibility: Return all files recursively when no folder param specified
            files = []
            root_dir = '.'
            
            for root, dirs, filenames in os.walk(root_dir):
                filtered_dirs = []
                for d in dirs:
                    dir_path = os.path.join(root, d)
                    if not is_hidden(dir_path) and d != 'uploads':
                        filtered_dirs.append(d)
                dirs[:] = filtered_dirs
                
                for filename in filenames:
                    try:
                        full_path = os.path.join(root, filename)
                        
                        if is_hidden(full_path):
                            continue
                        
                        rel_path = os.path.relpath(full_path, root_dir).replace('\\', '/')
                        file_size = os.path.getsize(full_path)
                        files.append({
                            'path': rel_path,
                            'name': filename,
                            'size': file_size,
                            'directory': root.replace('\\', '/')
                        })
                    except (OSError, ValueError):
                        continue
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(files).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            error_response = json.dumps({'error': str(e)})
            self.wfile.write(error_response.encode())
    
    def send_file(self):
        # Handle file/folder downloads: Extract path from /download/ URL, validate security, and stream file or ZIP
        parsed_path = urllib.parse.urlparse(self.path)
        download_path = parsed_path.path
        
        if not download_path.startswith('/download/'):
            self.send_error(404, "Invalid download path")
            return
            
        encoded_path = download_path[10:]
        filepath = urllib.parse.unquote(encoded_path)
        
        filepath = os.path.normpath(filepath)
        
        # Security: Prevent directory traversal by ensuring file is within server root
        abs_filepath = os.path.abspath(filepath)
        server_root = SCRIPT_DIR
        try:
            os.path.relpath(abs_filepath, server_root)
            if not abs_filepath.startswith(server_root):
                self.send_error(403, "Invalid file path")
                return
        except ValueError:
            self.send_error(403, "Invalid file path")
            return
        
        if not os.path.exists(filepath):
            self.send_error(404, f"File or folder not found: {filepath}")
            return
        
        try:
            # Check if it's a folder
            if os.path.isdir(filepath):
                # Create a ZIP file for the folder
                zip_buffer = io.BytesIO()
                folder_name = os.path.basename(filepath) or 'folder'
                
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                    # Walk through the folder and add all files
                    for root, dirs, files in os.walk(filepath):
                        # Filter out hidden directories and 'uploads' folder
                        dirs[:] = [d for d in dirs if not is_hidden(os.path.join(root, d)) and d != 'uploads']
                        
                        for file in files:
                            file_path = os.path.join(root, file)
                            if not is_hidden(file_path):
                                try:
                                    # Get relative path from the folder being zipped
                                    arcname = os.path.relpath(file_path, filepath)
                                    zip_file.write(file_path, arcname)
                                except (OSError, PermissionError):
                                    # Skip files that can't be accessed
                                    continue
                
                zip_buffer.seek(0)
                content = zip_buffer.read()
                zip_buffer.close()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/zip')
                self.send_header('Content-Disposition', f'attachment; filename="{folder_name}.zip"')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                # It's a file, send it directly
                with open(filepath, 'rb') as f:
                    content = f.read()
                
                self.send_response(200)
                filename = os.path.basename(filepath)
                self.send_header('Content-type', 'application/octet-stream')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error: {str(e)}")
    def do_POST(self):
        # Handle file uploads: Parse multipart/form-data, extract files, and save to uploads directory
        try:
            content_type = self.headers.get('Content-Type', '')
            if not content_type.startswith('multipart/form-data'):
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Invalid content type")
                return

            boundary_match = re.search(r'boundary=([^;]+)', content_type)
            if not boundary_match:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing boundary")
                return

            boundary = boundary_match.group(1).strip('"')
            boundary_bytes = boundary.encode()

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            # Parse multipart form data and extract file contents
            parts = body.split(b'--' + boundary_bytes)
            uploaded_files = []

            for part in parts:
                if b'Content-Disposition: form-data' in part:
                    filename_match = re.search(rb'filename="([^"]+)"', part)
                    if filename_match:
                        filename = filename_match.group(1).decode('utf-8', errors='ignore')
                        header_end = part.find(b'\r\n\r\n')
                        if header_end != -1:
                            file_data = part[header_end + 4:]
                            file_data = file_data.rstrip()
                            if file_data.endswith(b'--'):
                                file_data = file_data[:-2].rstrip()
                            
                            if len(file_data) > 0:
                                filepath = os.path.join(UPLOAD_DIR, filename)
                                with open(filepath, 'wb') as f:
                                    f.write(file_data)
                                uploaded_files.append(filename)

            if uploaded_files:
                if len(uploaded_files) == 1:
                    message = f"File '{uploaded_files[0]}' uploaded successfully"
                else:
                    message = f"{len(uploaded_files)} files uploaded successfully"
                self.send_response(200)
                self.end_headers()
                self.wfile.write(message.encode())
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"No file found in request")
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f"Error: {str(e)}".encode())

# Start HTTP server on all interfaces, port 1313
server = HTTPServer(("0.0.0.0", 1313), UploadHandler)
print("Upload server running on port 1313")
server.serve_forever()
