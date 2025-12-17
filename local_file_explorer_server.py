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
                dirnames[:] = [d for d in dirnames if not is_hidden(os.path.join(dirpath, d)) and d != 'uploads' and d != 'assets']
            
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
    def do_OPTIONS(self):
        # Handle CORS preflight requests for range requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Range, Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()
    
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
            # Get file size for range requests
            file_size = os.path.getsize(filepath)
            
            # Determine content type based on file extension
            content_type = 'application/octet-stream'
            ext = os.path.splitext(filepath)[1].lower()
            
            # Text and web files
            if ext == '.html' or ext == '.htm':
                content_type = 'text/html; charset=utf-8'
            elif ext == '.css':
                content_type = 'text/css; charset=utf-8'
            elif ext == '.js':
                content_type = 'application/javascript; charset=utf-8'
            elif ext == '.json':
                content_type = 'application/json; charset=utf-8'
            elif ext == '.txt':
                content_type = 'text/plain; charset=utf-8'
            elif ext == '.md':
                content_type = 'text/markdown; charset=utf-8'
            elif ext == '.xml':
                content_type = 'application/xml; charset=utf-8'
            elif ext == '.csv':
                content_type = 'text/csv; charset=utf-8'
            # Document files
            elif ext == '.pdf':
                content_type = 'application/pdf'
            elif ext == '.doc':
                content_type = 'application/msword'
            elif ext == '.docx':
                content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            elif ext == '.xls':
                content_type = 'application/vnd.ms-excel'
            elif ext == '.xlsx':
                content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            elif ext == '.ppt':
                content_type = 'application/vnd.ms-powerpoint'
            elif ext == '.pptx':
                content_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            elif ext == '.rtf':
                content_type = 'application/rtf'
            elif ext == '.odt':
                content_type = 'application/vnd.oasis.opendocument.text'
            elif ext == '.ods':
                content_type = 'application/vnd.oasis.opendocument.spreadsheet'
            elif ext == '.odp':
                content_type = 'application/vnd.oasis.opendocument.presentation'
            # Images
            elif ext == '.png':
                content_type = 'image/png'
            elif ext in ['.jpg', '.jpeg']:
                content_type = 'image/jpeg'
            elif ext == '.gif':
                content_type = 'image/gif'
            elif ext == '.ico':
                content_type = 'image/x-icon'
            elif ext == '.svg':
                content_type = 'image/svg+xml'
            elif ext in ['.bmp', '.webp', '.tiff', '.tif']:
                content_type = f'image/{ext[1:]}'
            # Audio files
            elif ext == '.mp3':
                content_type = 'audio/mpeg'
            elif ext == '.wav':
                content_type = 'audio/wav'
            elif ext == '.flac':
                content_type = 'audio/flac'
            elif ext == '.ogg':
                content_type = 'audio/ogg'
            elif ext == '.aac':
                content_type = 'audio/aac'
            elif ext == '.m4a':
                content_type = 'audio/mp4'
            elif ext == '.wma':
                content_type = 'audio/x-ms-wma'
            # Video files
            elif ext == '.mp4':
                content_type = 'video/mp4'
            elif ext == '.webm':
                content_type = 'video/webm'
            elif ext == '.ogg':
                content_type = 'video/ogg'
            elif ext == '.avi':
                content_type = 'video/x-msvideo'
            elif ext == '.mkv':
                content_type = 'video/x-matroska'
            elif ext == '.mov':
                content_type = 'video/quicktime'
            elif ext == '.wmv':
                content_type = 'video/x-ms-wmv'
            elif ext == '.flv':
                content_type = 'video/x-flv'
            elif ext == '.m4v':
                content_type = 'video/mp4'
            elif ext == '.3gp':
                content_type = 'video/3gpp'
            
            # Handle range requests for media files (streaming support)
            range_header = self.headers.get('Range')
            if range_header and (content_type.startswith('audio/') or content_type.startswith('video/')):
                # Parse range header
                range_match = re.match(r'bytes=(\d+)-(\d*)', range_header)
                if range_match:
                    start = int(range_match.group(1))
                    end = int(range_match.group(2)) if range_match.group(2) else file_size - 1
                    
                    if start >= file_size or end >= file_size or start > end:
                        self.send_error(416, "Range Not Satisfiable")
                        return
                    
                    # Send 206 Partial Content
                    self.send_response(206)
                    self.send_header('Content-type', content_type)
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Content-Length', str(end - start + 1))
                    self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                    self.end_headers()
                    
                    # Stream the requested range with larger chunks for speed
                    with open(filepath, 'rb') as f:
                        f.seek(start)
                        remaining = end - start + 1
                        while remaining > 0:
                            chunk_size = min(1024 * 1024, remaining)  # 1MB chunks
                            chunk = f.read(chunk_size)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    return
            
            # Regular file serving (no range request)
            self.send_response(200)
            self.send_header('Content-type', content_type)
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(file_size))
            self.end_headers()
            
            # For small files, read all at once; for large files, stream with large chunks
            if file_size < 10 * 1024 * 1024:  # Less than 10MB
                with open(filepath, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                # Stream large files in 1MB chunks for better speed
                with open(filepath, 'rb') as f:
                    while True:
                        chunk = f.read(1024 * 1024)  # 1MB chunks
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            # Client disconnected during file transfer - this is normal, just ignore
            pass
        except Exception as e:
            # Only send error if connection is still open
            try:
                self.send_error(500, f"Error: {str(e)}")
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                # Connection closed while trying to send error - ignore
                pass
    
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
                        
                        if is_hidden(item_path) or item == 'uploads' or item == 'assets':
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
                    if not is_hidden(dir_path) and d != 'uploads' and d != 'assets':
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
                        dirs[:] = [d for d in dirs if not is_hidden(os.path.join(root, d)) and d != 'uploads' and d != 'assets']
                        
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
                # It's a file, send it directly with proper MIME type
                file_size = os.path.getsize(filepath)
                filename = os.path.basename(filepath)
                
                # Determine content type
                content_type = 'application/octet-stream'
                ext = os.path.splitext(filepath)[1].lower()
                
                # Text and web files
                if ext == '.html' or ext == '.htm':
                    content_type = 'text/html; charset=utf-8'
                elif ext == '.txt':
                    content_type = 'text/plain; charset=utf-8'
                elif ext == '.md':
                    content_type = 'text/markdown; charset=utf-8'
                elif ext == '.xml':
                    content_type = 'application/xml; charset=utf-8'
                elif ext == '.csv':
                    content_type = 'text/csv; charset=utf-8'
                # Document files
                elif ext == '.pdf':
                    content_type = 'application/pdf'
                elif ext == '.doc':
                    content_type = 'application/msword'
                elif ext == '.docx':
                    content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                elif ext == '.xls':
                    content_type = 'application/vnd.ms-excel'
                elif ext == '.xlsx':
                    content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                elif ext == '.ppt':
                    content_type = 'application/vnd.ms-powerpoint'
                elif ext == '.pptx':
                    content_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                elif ext == '.rtf':
                    content_type = 'application/rtf'
                elif ext == '.odt':
                    content_type = 'application/vnd.oasis.opendocument.text'
                elif ext == '.ods':
                    content_type = 'application/vnd.oasis.opendocument.spreadsheet'
                elif ext == '.odp':
                    content_type = 'application/vnd.oasis.opendocument.presentation'
                # Audio files
                elif ext == '.mp3':
                    content_type = 'audio/mpeg'
                elif ext == '.wav':
                    content_type = 'audio/wav'
                elif ext == '.flac':
                    content_type = 'audio/flac'
                elif ext == '.ogg':
                    content_type = 'audio/ogg'
                elif ext == '.aac':
                    content_type = 'audio/aac'
                elif ext == '.m4a':
                    content_type = 'audio/mp4'
                elif ext == '.wma':
                    content_type = 'audio/x-ms-wma'
                # Video files
                elif ext == '.mp4':
                    content_type = 'video/mp4'
                elif ext == '.webm':
                    content_type = 'video/webm'
                elif ext == '.avi':
                    content_type = 'video/x-msvideo'
                elif ext == '.mkv':
                    content_type = 'video/x-matroska'
                elif ext == '.mov':
                    content_type = 'video/quicktime'
                elif ext == '.wmv':
                    content_type = 'video/x-ms-wmv'
                elif ext == '.flv':
                    content_type = 'video/x-flv'
                elif ext == '.m4v':
                    content_type = 'video/mp4'
                elif ext == '.3gp':
                    content_type = 'video/3gpp'
                # Images
                elif ext == '.png':
                    content_type = 'image/png'
                elif ext in ['.jpg', '.jpeg']:
                    content_type = 'image/jpeg'
                elif ext == '.gif':
                    content_type = 'image/gif'
                elif ext == '.webp':
                    content_type = 'image/webp'
                
                # Handle range requests for media streaming and PDFs (required for seeking/efficient loading)
                range_header = self.headers.get('Range')
                if range_header and (content_type.startswith('audio/') or content_type.startswith('video/') or content_type == 'application/pdf'):
                    range_match = re.match(r'bytes=(\d+)-(\d*)', range_header)
                    if range_match:
                        start = int(range_match.group(1))
                        end = int(range_match.group(2)) if range_match.group(2) else file_size - 1
                        
                        # Validate range: start must be < file_size, end must be < file_size, and start <= end
                        if start >= 0 and end < file_size and start <= end:
                            self.send_response(206)
                            self.send_header('Content-type', content_type)
                            self.send_header('Accept-Ranges', 'bytes')
                            self.send_header('Content-Length', str(end - start + 1))
                            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                            # Always use 'inline' for PDFs to display in browser
                            if content_type == 'application/pdf':
                                self.send_header('Content-Disposition', f'inline; filename="{filename}"')
                            else:
                                self.send_header('Content-Disposition', f'inline; filename="{filename}"')
                            self.send_header('Cache-Control', 'no-cache')
                            self.send_header('Access-Control-Allow-Origin', '*')
                            self.send_header('Access-Control-Allow-Headers', 'Range')
                            self.end_headers()
                            
                            with open(filepath, 'rb') as f:
                                f.seek(start)
                                remaining = end - start + 1
                                while remaining > 0:
                                    chunk_size = min(1024 * 1024, remaining)  # 1MB chunks
                                    chunk = f.read(chunk_size)
                                    if not chunk:
                                        break
                                    self.wfile.write(chunk)
                                    remaining -= len(chunk)
                            return
                
                # Regular file serving (no range request or not media/PDF file)
                # Use 'inline' for media files, PDFs, HTML, and text files to allow preview/playback, 'attachment' for others to force download
                isPreviewable = (content_type.startswith('audio/') or 
                               content_type.startswith('video/') or 
                               content_type.startswith('image/') or
                               content_type == 'application/pdf' or
                               content_type.startswith('text/') or
                               content_type.startswith('application/xml') or
                               content_type.startswith('application/json'))
                # Always use 'inline' for PDFs to ensure they display in browser, not download
                if content_type == 'application/pdf':
                    disposition = 'inline'
                else:
                    disposition = 'inline' if isPreviewable else 'attachment'
                
                self.send_response(200)
                self.send_header('Content-type', content_type)
                self.send_header('Content-Disposition', f'{disposition}; filename="{filename}"')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Headers', 'Range')
                # Add X-Content-Type-Options to prevent MIME sniffing that might cause downloads
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                
                # Stream file in large chunks for better speed
                with open(filepath, 'rb') as f:
                    while True:
                        chunk = f.read(1024 * 1024)  # 1MB chunks
                        if not chunk:
                            break
                        self.wfile.write(chunk)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            # Client disconnected during file transfer - this is normal, just ignore
            pass
        except Exception as e:
            # Only send error if connection is still open
            try:
                self.send_error(500, f"Error: {str(e)}")
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                # Connection closed while trying to send error - ignore
                pass
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
            
            # Stream upload directly to file for large files
            uploaded_files = []
            
            # Read in chunks for better memory efficiency
            chunk_size = 1024 * 1024  # 1MB chunks
            body = b''
            remaining = content_length
            while remaining > 0:
                read_size = min(chunk_size, remaining)
                chunk = self.rfile.read(read_size)
                if not chunk:
                    break
                body += chunk
                remaining -= len(chunk)

            # Parse multipart form data and extract file contents
            parts = body.split(b'--' + boundary_bytes)

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
                try:
                    self.wfile.write(message.encode())
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                    pass
            else:
                self.send_response(400)
                self.end_headers()
                try:
                    self.wfile.write(b"No file found in request")
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                    pass
        except Exception as e:
            try:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"Error: {str(e)}".encode())
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                pass

# Start HTTP server on all interfaces, port 1313
import socket

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

server = HTTPServer(("0.0.0.0", 1313), UploadHandler)
ip = get_local_ip()
print(f"Local File Explorer server running at http://{ip}:1313")

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped.")
    server.server_close()
