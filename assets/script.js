let allFiles = [];
let currentSort = { field: 'name', order: 'asc' };
let selectedFiles = new Set(); // Stores paths
let selectedFilesData = new Map(); // Stores path -> {type, size} for size calculation
let isSelectMode = false;
let expandedFolders = new Set(['.']); // Root folder expanded by default
let filesToUpload = []; // Array to store files selected for upload
let currentFolder = null; // Track the currently selected main folder
let folderStack = []; // Track navigation history for breadcrumbs

// Transfer progress state
let activeTransfer = null;
let transferQueue = [];
let isPaused = false;
let isCancelled = false;

// Function to update the page title with current directory
function updatePageTitle() {
  const rootDir = window.SERVER_ROOT_DIR || '';
  let currentPath = rootDir;
  
  if (currentFolder && currentFolder !== '.') {
    // Combine root directory with current folder path
    // Detect path separator from root directory (Windows uses \, Unix uses /)
    const separator = rootDir.includes('\\') ? '\\' : '/';
    
    // Normalize the current folder path to use the same separator
    const normalizedFolder = currentFolder.replace(/[/\\]/g, separator);
    
    // Join paths properly
    if (rootDir.endsWith(separator)) {
      currentPath = rootDir + normalizedFolder;
    } else {
      currentPath = rootDir + separator + normalizedFolder;
    }
  }
  
  document.title = currentPath || 'Live Preview | File Explorer';
}

// Haptic feedback utility functions
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

function triggerHapticFeedback() {
  if (isMobileDevice() && navigator.vibrate) {
    // Subtle vibration: 10ms duration
    navigator.vibrate(10);
  }
}

function attachHapticFeedback(element) {
  if (!element || !isMobileDevice()) return;
  
  // Skip if already has haptic feedback attached
  if (element.dataset.hapticAttached === 'true') return;
  
  // Mark as attached
  element.dataset.hapticAttached = 'true';
  
  // Only use click event to avoid double vibration (touchstart + click)
  element.addEventListener('click', function(e) {
    triggerHapticFeedback();
  }, { passive: true });
}

function setupHapticFeedbackForDynamicElements() {
  if (!isMobileDevice()) return;
  
  // Attach to all buttons (excluding those already marked)
  document.querySelectorAll('button:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);
  
  // Attach to clickable text elements (breadcrumbs, folder items, file items)
  document.querySelectorAll('.breadcrumb-item:not([data-haptic-attached="true"]), .folder-item:not([data-haptic-attached="true"]), .file-item.selectable:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);
  
  // Attach to download links
  document.querySelectorAll('.download-btn:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);
  
  // Attach to footer links
  document.querySelectorAll('.footer-link:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);

  // Attach to sort options
  document.querySelectorAll('.sort-option:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);
  
  // Attach to checkboxes
  document.querySelectorAll('.item-checkbox:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);
  
  // Attach to download action buttons
  document.querySelectorAll('.download-actions button:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);
  
  // Attach to file list remove buttons in upload modal
  document.querySelectorAll('#fileListToUpload button:not([data-haptic-attached="true"])').forEach(attachHapticFeedback);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function getFileType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return ext || 'unknown';
}

function isImageFile(filename) {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif'];
  const ext = getFileType(filename);
  return imageExtensions.includes(ext);
}

function isAudioFile(filename) {
  const audioExtensions = ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'opus', 'mpa', 'wav', 'flac'];
  const ext = getFileType(filename);
  return audioExtensions.includes(ext);
}

function isVideoFile(filename) {
  const videoExtensions = ['mp4', 'webm', 'ogg', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'm4v', '3gp', 'mpg', 'mpeg', 'm2v'];
  const ext = getFileType(filename);
  return videoExtensions.includes(ext);
}

function isMediaFile(filename) {
  return isAudioFile(filename) || isVideoFile(filename);
}

function isTextFile(filename) {
  const textExtensions = ['txt', 'md', 'log', 'json', 'xml', 'csv', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'config', 'env', 'sh', 'bat', 'ps1', 'py', 'js', 'html', 'htm', 'css', 'java', 'cpp', 'c', 'h', 'hpp', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'ts', 'tsx', 'jsx', 'vue', 'svelte'];
  const ext = getFileType(filename);
  return textExtensions.includes(ext);
}

function isPdfFile(filename) {
  const ext = getFileType(filename);
  return ext === 'pdf';
}

function isHtmlFile(filename) {
  const ext = getFileType(filename);
  return ext === 'html' || ext === 'htm';
}

function isDocumentFile(filename) {
  const documentExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'];
  const ext = getFileType(filename);
  return documentExtensions.includes(ext);
}

function isPreviewableFile(filename) {
  return isTextFile(filename) || isHtmlFile(filename) || isDocumentFile(filename);
}

function getMediaMimeType(filename) {
  const ext = getFileType(filename);
  const mimeTypes = {
    // Audio
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'flac': 'audio/flac',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'm4a': 'audio/mp4',
    'wma': 'audio/x-ms-wma',
    'opus': 'audio/opus',
    // Video
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'm4v': 'video/mp4',
    '3gp': 'video/3gpp',
    'mpg': 'video/mpeg',
    'mpeg': 'video/mpeg'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function showImagePreview(filePath, fileName, fileSize) {
  const modal = document.getElementById('imagePreviewModal');
  const img = document.getElementById('imagePreviewImg');
  const nameSpan = document.getElementById('imagePreviewName');
  const sizeSpan = document.getElementById('imagePreviewSize');
  const downloadLink = document.getElementById('imagePreviewDownload');
  
  // Set image source
  const imageUrl = `/download/${encodeURIComponent(filePath)}`;
  img.src = imageUrl;
  
  // Set file name
  nameSpan.textContent = fileName;
  
  // Set file size
  if (fileSize !== undefined && fileSize !== null) {
    sizeSpan.textContent = formatSize(fileSize);
  } else {
    sizeSpan.textContent = '';
  }
  
  // Set download link
  downloadLink.href = imageUrl;
  downloadLink.download = fileName;
  
  // Show modal
  modal.classList.add('show');
  
  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
}

function hideImagePreview() {
  const modal = document.getElementById('imagePreviewModal');
  modal.classList.remove('show');
  
  // Restore body scroll
  document.body.style.overflow = '';
  
  // Clear image source to free memory
  const img = document.getElementById('imagePreviewImg');
  img.src = '';
}

function showMediaPlayer(filePath, fileName, fileSize) {
  const modal = document.getElementById('mediaPlayerModal');
  const videoElement = document.getElementById('mediaPlayerVideo');
  const audioElement = document.getElementById('mediaPlayerAudio');
  const nameSpan = document.getElementById('mediaPlayerName');
  const sizeSpan = document.getElementById('mediaPlayerSize');
  const downloadLink = document.getElementById('mediaPlayerDownload');
  
  // Ensure modal is closed first (in case it was left open)
  if (modal.classList.contains('show')) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
  
  // Set media source URL
  const mediaUrl = `/download/${encodeURIComponent(filePath)}`;
  const mimeType = getMediaMimeType(fileName);
  
  // Fully reset both players first to ensure clean state
  // Reset video element
  try {
    videoElement.pause();
    videoElement.currentTime = 0;
    videoElement.src = '';
    videoElement.removeAttribute('src'); // Ensure src attribute is removed
    while (videoElement.firstChild) {
      videoElement.removeChild(videoElement.firstChild);
    }
    videoElement.load();
    videoElement.style.display = 'none';
  } catch (e) {
    console.warn('Error resetting video element:', e);
  }
  
  // Reset audio element
  try {
    audioElement.pause();
    audioElement.currentTime = 0;
    audioElement.src = '';
    audioElement.removeAttribute('src'); // Ensure src attribute is removed
    while (audioElement.firstChild) {
      audioElement.removeChild(audioElement.firstChild);
    }
    audioElement.load();
    audioElement.style.display = 'none';
  } catch (e) {
    console.warn('Error resetting audio element:', e);
  }
  
  // Determine if it's audio or video
  if (isVideoFile(fileName)) {
    // Setup video player with proper attributes for seeking
    // Clear existing sources first (already done above, but ensure it's clean)
    while (videoElement.firstChild) {
      videoElement.removeChild(videoElement.firstChild);
    }
    
    // Set video source directly for better seeking support
    videoElement.src = mediaUrl;
    
    // Also add source element as fallback
    const source = document.createElement('source');
    source.src = mediaUrl;
    source.type = mimeType;
    videoElement.appendChild(source);
    
    // Ensure proper attributes for seeking
    videoElement.setAttribute('controls', '');
    videoElement.setAttribute('preload', 'metadata');
    videoElement.setAttribute('autoplay', '');
    videoElement.setAttribute('controlsList', 'nodownload');
    videoElement.removeAttribute('loop');
    
    // Load the new source
    videoElement.load();
    videoElement.style.display = 'block';
    
  } else if (isAudioFile(fileName)) {
    // Setup audio player with proper attributes for seeking
    // Clear existing sources first (already done above, but ensure it's clean)
    while (audioElement.firstChild) {
      audioElement.removeChild(audioElement.firstChild);
    }
    
    // Set audio source directly for better seeking support
    audioElement.src = mediaUrl;
    
    // Also add source element as fallback
    const source = document.createElement('source');
    source.src = mediaUrl;
    source.type = mimeType;
    audioElement.appendChild(source);
    
    // Ensure proper attributes for seeking
    audioElement.setAttribute('controls', '');
    audioElement.setAttribute('preload', 'metadata');
    audioElement.setAttribute('autoplay', '');
    audioElement.setAttribute('controlsList', 'nodownload');
    audioElement.removeAttribute('loop');
    
    // Load the new source
    audioElement.load();
    audioElement.style.display = 'block';
  }
  
  // Set file name
  nameSpan.textContent = fileName;
  
  // Set file size
  if (fileSize !== undefined && fileSize !== null) {
    sizeSpan.textContent = formatSize(fileSize);
  } else {
    sizeSpan.textContent = '';
  }
  
  // Set download link
  downloadLink.href = mediaUrl;
  downloadLink.download = fileName;
  
  // Show modal
  modal.classList.add('show');
  
  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
}

function hideMediaPlayer() {
  const modal = document.getElementById('mediaPlayerModal');
  const videoElement = document.getElementById('mediaPlayerVideo');
  const audioElement = document.getElementById('mediaPlayerAudio');
  
  // Pause and fully reset video element
  videoElement.pause();
  videoElement.currentTime = 0;
  videoElement.src = '';
  // Remove all source elements
  while (videoElement.firstChild) {
    videoElement.removeChild(videoElement.firstChild);
  }
  videoElement.style.display = 'none';
  // Reset the element by calling load() to clear any internal state
  videoElement.load();
  
  // Pause and fully reset audio element
  audioElement.pause();
  audioElement.currentTime = 0;
  audioElement.src = '';
  // Remove all source elements
  while (audioElement.firstChild) {
    audioElement.removeChild(audioElement.firstChild);
  }
  audioElement.style.display = 'none';
  // Reset the element by calling load() to clear any internal state
  audioElement.load();
  
  modal.classList.remove('show');
  
  // Restore body scroll
  document.body.style.overflow = '';
}

function showDocumentPreview(filePath, fileName, fileSize) {
  const modal = document.getElementById('documentPreviewModal');
  const nameSpan = document.getElementById('documentPreviewName');
  const sizeSpan = document.getElementById('documentPreviewSize');
  const downloadLink = document.getElementById('documentPreviewDownload');
  const iframe = document.getElementById('documentPreviewIframe');
  const textPreview = document.getElementById('documentPreviewText');
  const errorDiv = document.getElementById('documentPreviewError');
  const loadingDiv = document.getElementById('documentPreviewLoading');
  
  // Set file name and size
  nameSpan.textContent = fileName;
  if (fileSize !== undefined && fileSize !== null) {
    sizeSpan.textContent = formatSize(fileSize);
  } else {
    sizeSpan.textContent = '';
  }
  
  // Set download link
  const fileUrl = `/download/${encodeURIComponent(filePath)}`;
  downloadLink.href = fileUrl;
  downloadLink.download = fileName;
  
  // Hide all preview elements initially
  iframe.style.display = 'none';
  textPreview.style.display = 'none';
  errorDiv.style.display = 'none';
  loadingDiv.style.display = 'block';
  
  // Show modal
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  
  // Determine file type and load accordingly
  const ext = getFileType(fileName).toLowerCase();
  
  // HTML files and text files - fetch and display as plain text (source code)
  if (isHtmlFile(fileName) || isTextFile(fileName)) {
    // Text files and HTML files - fetch and display as plain text
    fetch(fileUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load file');
        }
        return response.text();
      })
      .then(text => {
        loadingDiv.style.display = 'none';
        textPreview.textContent = text;
        textPreview.style.display = 'block';
      })
      .catch(error => {
        loadingDiv.style.display = 'none';
        errorDiv.style.display = 'block';
        errorDiv.textContent = `Unable to preview file: ${error.message}. Please download the file to view it.`;
      });
      
  } else if (isDocumentFile(fileName)) {
    // DOC/DOCX and other Office documents - show message
    loadingDiv.style.display = 'none';
    errorDiv.style.display = 'block';
    errorDiv.innerHTML = `
      <p>This file type (${ext.toUpperCase()}) cannot be previewed in the browser.</p>
      <p>Please download the file to view it with a compatible application.</p>
    `;
  } else {
    // Unknown document type
    loadingDiv.style.display = 'none';
    errorDiv.style.display = 'block';
    errorDiv.textContent = 'Preview not available for this file type. Please download the file to view it.';
  }
}

function hideDocumentPreview() {
  const modal = document.getElementById('documentPreviewModal');
  const iframe = document.getElementById('documentPreviewIframe');
  const textPreview = document.getElementById('documentPreviewText');
  
  // Clear iframe source
  iframe.src = '';
  
  // Clear text preview
  textPreview.textContent = '';
  
  modal.classList.remove('show');
  
  // Restore body scroll
  document.body.style.overflow = '';
}

function handleFileClick(event) {
  // Don't handle if clicking on download button
  if (event.target.classList.contains('download-btn') || event.target.closest('.download-btn')) {
    return;
  }
  
  // Get file info from the clicked element
  const fileItem = event.currentTarget;
  const filePath = fileItem.getAttribute('data-path');
  
  if (!filePath) return;
  
  // Try to get filename from allFiles first (most reliable)
  const file = allFiles.find(f => f.path === filePath);
  let fileName = file ? file.name : null;
  
  // Fallback: extract filename from path or item-name
  if (!fileName) {
    // Extract filename from path (handle both / and \ separators)
    const pathParts = filePath.split(/[/\\]/);
    fileName = pathParts[pathParts.length - 1];
    
    // If that doesn't work, try getting from DOM
    if (!fileName) {
      const itemName = fileItem.querySelector('.item-name');
      if (itemName) {
        // Remove any secondary-text spans (directory paths) and get just the filename
        const clone = itemName.cloneNode(true);
        const secondaryTexts = clone.querySelectorAll('.secondary-text');
        secondaryTexts.forEach(el => el.remove());
        fileName = clone.textContent.trim();
      }
    }
  }
  
  if (!fileName) return;
  
  const fileSize = file ? file.size : null;
  
  // Check if file is a media file (audio or video)
  if (isMediaFile(fileName)) {
    showMediaPlayer(filePath, fileName, fileSize);
  }
  // Check if file is an image
  else if (isImageFile(fileName)) {
    showImagePreview(filePath, fileName, fileSize);
  }
  // Check if file is a PDF - open in new tab
  else if (isPdfFile(fileName)) {
    const fileUrl = `/download/${encodeURIComponent(filePath)}`;
    window.open(fileUrl, '_blank');
  }
  // Check if file is a previewable document (excluding PDF)
  else if (isPreviewableFile(fileName) && !isPdfFile(fileName)) {
    showDocumentPreview(filePath, fileName, fileSize);
  }
}

function loadFiles() {
  // Check if we're searching in root - if so, load all files for search
  const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
  const isSearchingInRoot = !currentFolder && searchTerm.length > 0;
  
  // If searching in root, load all files; otherwise load folders/items for current folder
  const url = isSearchingInRoot ? '/api/files' : `/api/files?folder=${encodeURIComponent(currentFolder || '.')}`;
  
  fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Expected JSON response but got: ' + contentType);
      }
      return response.json();
    })
    .then(data => {
      if (!Array.isArray(data)) {
        document.getElementById('fileList').innerHTML = '<p style="color: red;">Invalid response format</p>';
        return;
      }
      
      // If searching in root, data contains all files with directory info
      // Otherwise, data contains folders/items for current folder
      allFiles = data;
      displayFiles();
    })
    .catch(error => {
      document.getElementById('fileList').innerHTML = 
        `<p style="color: red;">Error loading files: ${error.message}</p>`;
    });
}

function sortFiles(files) {
  const sorted = [...files];
  
  sorted.sort((a, b) => {
    let comparison = 0;
    
    switch(currentSort.field) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'size':
        comparison = a.size - b.size;
        break;
      case 'type':
        comparison = getFileType(a.name).localeCompare(getFileType(b.name));
        if (comparison === 0) {
          comparison = a.name.localeCompare(b.name);
        }
        break;
    }
    
    return currentSort.order === 'asc' ? comparison : -comparison;
  });
  
  return sorted;
}

function displayFiles() {
  const fileListDiv = document.getElementById('fileList');
  const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
  
  // If we're in folder view (currentFolder is set), display subfolders and files
  if (currentFolder) {
    // Build breadcrumb navigation
    let breadcrumbHtml = '<div class="breadcrumb-nav" style="padding: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--border-color);">';
    breadcrumbHtml += '<span class="breadcrumb-item" onclick="navigateToFolder(null)" style="cursor: pointer; color: var(--link-color);">Root</span>';
    
    const pathParts = currentFolder.split('/').filter(p => p);
    let currentPath = '';
    pathParts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      breadcrumbHtml += ' <span style="margin: 0 5px;">/</span> ';
      if (index < pathParts.length - 1) {
        breadcrumbHtml += `<span class="breadcrumb-item" onclick="navigateToFolder('${currentPath.replace(/'/g, "\\'")}')" style="cursor: pointer; color: var(--link-color);">${escapeHtml(part)}</span>`;
      } else {
        breadcrumbHtml += `<span class="breadcrumb-item" style="color: var(--text-color); font-weight: bold;">${escapeHtml(part)}</span>`;
      }
    });
    breadcrumbHtml += '</div>';
    
    // Filter items by search term
    let filteredItems = allFiles.filter(item => 
      item.name.toLowerCase().includes(searchTerm)
    );
    
    // Separate folders and files
    const folders = filteredItems.filter(item => item.type === 'folder');
    const files = filteredItems.filter(item => item.type === 'file');
    
    // Sort folders and files separately
    folders.sort((a, b) => {
      let comparison = 0;
      switch(currentSort.field) {
        case 'name':
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case 'type':
          // Folders are always type 'folder', so just sort by name
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        default:
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      }
      return currentSort.order === 'asc' ? comparison : -comparison;
    });
    
    files.sort((a, b) => {
      let comparison = 0;
      switch(currentSort.field) {
        case 'name':
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case 'type':
          comparison = getFileType(a.name).localeCompare(getFileType(b.name));
          if (comparison === 0) {
            comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          }
          break;
      }
      return currentSort.order === 'asc' ? comparison : -comparison;
    });
    
    if (folders.length === 0 && files.length === 0) {
      fileListDiv.className = '';
      fileListDiv.innerHTML = breadcrumbHtml + '<p style="text-align: center; padding: 40px; color: #666;">No items found.</p>';
      updateDownloadActions();
      
      // Setup haptic feedback for dynamically created elements
      setupHapticFeedbackForDynamicElements();
      return;
    }
    
    let html = breadcrumbHtml + '<ul class="file-list">';
    
    // Display folders first
    folders.forEach(folder => {
      const isSelected = selectedFiles.has(folder.path);
      const escapedPath = escapeHtml(folder.path);
      const escapedName = escapeHtml(folder.name);
      const jsEscapedPath = folder.path.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      
      html += `
        <li class="folder-item ${isSelectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}" data-path="${escapedPath}" data-type="folder" onclick="handleFolderRowClick(event, '${jsEscapedPath}')" style="cursor: pointer;">
          ${isSelectMode ? `<input type="checkbox" class="item-checkbox" data-path="${escapedPath}" data-type="folder" ${isSelected ? 'checked' : ''} onchange="toggleSelection('${jsEscapedPath}', 'folder', this.checked)" onclick="event.stopPropagation()">` : ''}
          <span class="folder-toggle">▶</span>
          <img src="assets/folder.png" alt="folder" class="folder-icon">
          <span class="item-name" style="flex: 1;">${escapedName}</span>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="secondary-text">${formatSize(folder.size || 0)}</span>
          </div>
        </li>
      `;
    });
    
    // Display files after folders
    files.forEach(file => {
      const isSelected = selectedFiles.has(file.path);
      const escapedPath = escapeHtml(file.path);
      const escapedName = escapeHtml(file.name);
      const jsEscapedPath = file.path.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const downloadUrl = `/download/${encodeURIComponent(file.path)}`;
      
      const clickHandler = isSelectMode 
        ? `onclick="handleFileItemClick(event)"` 
        : `onclick="handleFileClick(event, '${jsEscapedPath}', '${escapedName.replace(/'/g, "\\'")}')"`;
      
      html += `
        <li class="file-item ${isSelectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}" data-path="${escapedPath}" data-type="file" ${clickHandler}>
          ${isSelectMode ? `<input type="checkbox" class="item-checkbox" data-path="${escapedPath}" data-type="file" ${isSelected ? 'checked' : ''} onchange="toggleSelection('${jsEscapedPath}', 'file', this.checked)" onclick="event.stopPropagation()">` : ''}
          <span class="item-name">${escapedName}</span>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="secondary-text">${formatSize(file.size || 0)}</span>
            ${!isSelectMode ? `<a href="${downloadUrl}" class="download-btn" download="${escapedName}" onclick="event.preventDefault(); downloadFileWithProgress('${jsEscapedPath}', '${escapedName.replace(/'/g, "\\'")}');">Download</a>` : ''}
          </div>
        </li>
      `;
    });
    
    html += '</ul>';
    fileListDiv.className = '';
    fileListDiv.innerHTML = html;
    updateDownloadActions();
    
    // Setup haptic feedback for dynamically created elements
    setupHapticFeedbackForDynamicElements();
    return;
  }
  
  // Root level
  // If searching, display all matching files; otherwise display only top-level folders
  if (searchTerm) {
    // Search mode: filter all files by search term
    let filteredFiles = allFiles.filter(file => 
      file.name.toLowerCase().includes(searchTerm) ||
      (file.directory && file.directory.toLowerCase().includes(searchTerm))
    );
    
    if (filteredFiles.length === 0) {
      fileListDiv.className = '';
      fileListDiv.innerHTML = '<p style="text-align: center; padding: 40px; color: #666;">No files found.</p>';
      updateDownloadActions();
      
      // Setup haptic feedback for dynamically created elements
      setupHapticFeedbackForDynamicElements();
      return;
    }
    
    // Sort filtered files
    filteredFiles = sortFiles(filteredFiles);
    
    let html = '<ul class="file-list">';
    
    filteredFiles.forEach(file => {
      const isSelected = selectedFiles.has(file.path);
      const escapedPath = escapeHtml(file.path);
      const escapedName = escapeHtml(file.name);
      const jsEscapedPath = file.path.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const downloadUrl = `/download/${encodeURIComponent(file.path)}`;
      
      // Show directory path for context in search results
      const dirPath = file.directory && file.directory !== '.' ? file.directory + '/' : '';
      
      const clickHandler = isSelectMode 
        ? `onclick="handleFileItemClick(event)"` 
        : `onclick="handleFileClick(event)"`;
      
      html += `
        <li class="file-item ${isSelectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}" data-path="${escapedPath}" data-type="file" ${clickHandler}>
          ${isSelectMode ? `<input type="checkbox" class="item-checkbox" data-path="${escapedPath}" data-type="file" ${isSelected ? 'checked' : ''} onchange="toggleSelection('${jsEscapedPath}', 'file', this.checked)" onclick="event.stopPropagation()">` : ''}
          <span class="item-name">
            ${dirPath ? `<span class="secondary-text">${escapeHtml(dirPath)}</span>` : ''}
            ${escapedName}
          </span>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="secondary-text">${formatSize(file.size || 0)}</span>
            ${!isSelectMode ? `<a href="${downloadUrl}" class="download-btn" download="${escapedName}" onclick="event.preventDefault(); downloadFileWithProgress('${jsEscapedPath}', '${escapedName.replace(/'/g, "\\'")}');">Download</a>` : ''}
          </div>
        </li>
      `;
    });
    
    html += '</ul>';
    fileListDiv.className = '';
    fileListDiv.innerHTML = html;
    updateDownloadActions();
    
    // Setup haptic feedback for dynamically created elements
    setupHapticFeedbackForDynamicElements();
    return;
  }
  
  // No search term - display top-level folders and files
  // Separate folders and files
  const folders = allFiles.filter(item => 
    item.type === 'folder' && item.name.toLowerCase().includes(searchTerm)
  );
  const files = allFiles.filter(item => 
    item.type === 'file' && item.name.toLowerCase().includes(searchTerm)
  );
  
  // Sort folders
  folders.sort((a, b) => {
    let comparison = 0;
    switch(currentSort.field) {
      case 'name':
        comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case 'size':
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case 'type':
        // Folders are always type 'folder', so just sort by name
        comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      default:
        comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }
    return currentSort.order === 'asc' ? comparison : -comparison;
  });
  
  // Sort files
  files.sort((a, b) => {
    let comparison = 0;
    switch(currentSort.field) {
      case 'name':
        comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        break;
      case 'size':
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case 'type':
        comparison = getFileType(a.name).localeCompare(getFileType(b.name));
        if (comparison === 0) {
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        }
        break;
    }
    return currentSort.order === 'asc' ? comparison : -comparison;
  });
  
  if (folders.length === 0 && files.length === 0) {
    fileListDiv.className = '';
    fileListDiv.innerHTML = '<p style="text-align: center; padding: 40px; color: #666;">No items found.</p>';
    updateDownloadActions();
    
    // Setup haptic feedback for dynamically created elements
    setupHapticFeedbackForDynamicElements();
    return;
  }
  
  let html = '<ul class="file-list">';
  
  // Display folders first - make them clickable to navigate
  folders.forEach(folder => {
    const isSelected = selectedFiles.has(folder.path);
    const escapedPath = escapeHtml(folder.path);
    const escapedName = escapeHtml(folder.name);
    const jsEscapedPath = folder.path.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    
      html += `
        <li class="folder-item ${isSelectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}" data-path="${escapedPath}" data-type="folder" onclick="handleFolderRowClick(event, '${jsEscapedPath}')" style="cursor: pointer;">
          ${isSelectMode ? `<input type="checkbox" class="item-checkbox" data-path="${escapedPath}" data-type="folder" ${isSelected ? 'checked' : ''} onchange="toggleSelection('${jsEscapedPath}', 'folder', this.checked)" onclick="event.stopPropagation()">` : ''}
          <span class="folder-toggle">▶</span>
          <img src="assets/folder.png" alt="folder" class="folder-icon">
          <span class="item-name" style="flex: 1;">${escapedName}</span>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="secondary-text">${formatSize(folder.size || 0)}</span>
          </div>
        </li>
      `;
  });
  
  // Display files after folders
  files.forEach(file => {
    const isSelected = selectedFiles.has(file.path);
    const escapedPath = escapeHtml(file.path);
    const escapedName = escapeHtml(file.name);
    const jsEscapedPath = file.path.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const downloadUrl = `/download/${encodeURIComponent(file.path)}`;
    
    const clickHandler = isSelectMode 
      ? `onclick="handleFileItemClick(event)"` 
      : `onclick="handleFileClick(event)"`;
    
    html += `
      <li class="file-item ${isSelectMode ? 'selectable' : ''} ${isSelected ? 'selected' : ''}" data-path="${escapedPath}" data-type="file" ${clickHandler}>
        ${isSelectMode ? `<input type="checkbox" class="item-checkbox" data-path="${escapedPath}" data-type="file" ${isSelected ? 'checked' : ''} onchange="toggleSelection('${jsEscapedPath}', 'file', this.checked)" onclick="event.stopPropagation()">` : ''}
        <span class="item-name">${escapedName}</span>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="secondary-text">${formatSize(file.size || 0)}</span>
          ${!isSelectMode ? `<a href="${downloadUrl}" class="download-btn" download="${escapedName}" onclick="event.preventDefault(); downloadFileWithProgress('${jsEscapedPath}', '${escapedName.replace(/'/g, "\\'")}');">Download</a>` : ''}
        </div>
      </li>
    `;
  });
  
  html += '</ul>';
  fileListDiv.className = ''; // Remove loading class
  fileListDiv.innerHTML = html;
  
  updateDownloadActions();
  
  // Setup haptic feedback for dynamically created elements
  setupHapticFeedbackForDynamicElements();
}

function handleFileItemClick(event) {
  // Don't toggle if clicking directly on the checkbox (it handles its own click)
  if (event.target.tagName === 'INPUT' || event.target.closest('.item-checkbox')) {
    return;
  }
  
  // Get the file item that was clicked
  const fileItem = event.currentTarget;
  const checkbox = fileItem.querySelector('.item-checkbox');
  
  if (checkbox) {
    // Toggle the checkbox and trigger its change event
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));
  }
}

function handleFolderRowClick(event, folderPath) {
  // Don't navigate if clicking directly on the checkbox (it handles its own click)
  if (event.target.tagName === 'INPUT' || event.target.closest('.item-checkbox')) {
    return;
  }
  
  // Navigate to the folder when clicking anywhere on the row
  navigateToFolder(folderPath);
}


function toggleSelection(path, type, checked) {
  // Path comes from onchange handler which uses jsEscapedPath (JavaScript-escaped)
  // But we need to match against data-path which is HTML-escaped
  // So we need to HTML-escape the path for comparison
  const htmlEscapedPath = escapeHtml(path);
  
  if (checked) {
    selectedFiles.add(path); // Store original path in Set
    
    // Store size information for size calculation
    // First try to get from allFiles (most reliable)
    const item = allFiles.find(f => f.path === path);
    if (item) {
      selectedFilesData.set(path, {
        type: type,
        size: item.size || 0
      });
    } else {
      // Fallback: try to get size from DOM element's data attributes or displayed text
      const escapedPathForSelector = htmlEscapedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const checkbox = document.querySelector(`input.item-checkbox[data-path="${escapedPathForSelector}"][data-type="${type}"]`);
      if (checkbox) {
        const listItem = checkbox.closest('.file-item, .folder-item');
        if (listItem) {
          // Try to get size from data attribute if available, otherwise use 0
          // The size will be recalculated when updateDownloadActions is called
          selectedFilesData.set(path, {
            type: type,
            size: 0 // Will try to recalculate from allFiles in calculateTotalSelectedSize
          });
        } else {
          selectedFilesData.set(path, {
            type: type,
            size: 0
          });
        }
      } else {
        selectedFilesData.set(path, {
          type: type,
          size: 0
        });
      }
    }
  } else {
    selectedFiles.delete(path);
    selectedFilesData.delete(path);
  }
  
  // Find the checkbox by matching the HTML-escaped path
  // Escape special regex characters for selector
  const escapedPathForSelector = htmlEscapedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checkbox = document.querySelector(`input.item-checkbox[data-path="${escapedPathForSelector}"][data-type="${type}"]`);
  
  if (checkbox) {
    const item = checkbox.closest('.file-item, .folder-item');
    if (item) {
      if (checked) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    }
  } else {
    // Fallback: Find by data-path attribute on list item
    const allItems = document.querySelectorAll('.file-item[data-type="file"], .folder-item[data-type="folder"]');
    
    allItems.forEach(item => {
      const itemPath = item.getAttribute('data-path');
      // Compare HTML-escaped paths
      if (itemPath === htmlEscapedPath) {
        if (checked) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      }
    });
  }
  
  updateDownloadActions();
}

function toggleSelectAll() {
  const checkboxes = document.querySelectorAll('.item-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  
  checkboxes.forEach(cb => {
    cb.checked = !allChecked;
    const path = cb.getAttribute('data-path');
    const type = cb.getAttribute('data-type');
    toggleSelection(path, type, !allChecked);
  });
}

function calculateTotalSelectedSize() {
  let totalSize = 0;
  
  selectedFiles.forEach(path => {
    // First try to get from stored data
    const storedData = selectedFilesData.get(path);
    if (storedData && storedData.size) {
      totalSize += storedData.size;
    } else {
      // Fallback: try to find in allFiles
      const item = allFiles.find(f => f.path === path);
      if (item && item.size) {
        totalSize += item.size;
        // Update stored data for future use
        selectedFilesData.set(path, {
          type: item.type || 'file',
          size: item.size
        });
      }
    }
  });
  
  return totalSize;
}

function updateDownloadActions() {
  let downloadActions = document.getElementById('downloadActions');
  if (!downloadActions) {
    const fileListContainer = document.querySelector('.file-list-container');
    const actionsDiv = document.createElement('div');
    actionsDiv.id = 'downloadActions';
    actionsDiv.className = 'download-actions'; // No 'show' class - hidden by default
    actionsDiv.innerHTML = `
      <div class="download-actions-main">
        <button onclick="downloadSelected()">Download Selected (0)</button>
        <span id="totalSizeDisplay" class="total-size-display"></span>
      </div>
      <div class="download-actions-secondary">
        <button id="selectAllBtn" onclick="selectAllFiles()" class="select-all-btn">Select All</button>
        <button onclick="exitSelectMode()" class="cancel-btn">Cancel</button>
      </div>
    `;
    // Put the actions bar at the bottom so it can stick to the bottom while scrolling
    fileListContainer.appendChild(actionsDiv);
    downloadActions = actionsDiv;
  }
  
  const downloadBtn = downloadActions.querySelector('button');
  const totalSizeDisplay = document.getElementById('totalSizeDisplay');
  const count = selectedFiles.size;
  const totalSize = calculateTotalSelectedSize();
  
  downloadBtn.textContent = `Download Selected (${count})`;
  downloadBtn.disabled = count === 0;
  
  // Update total size display
  if (totalSizeDisplay) {
    if (count > 0) {
      totalSizeDisplay.textContent = `Total: ${formatSize(totalSize)}`;
    } else {
      totalSizeDisplay.textContent = '';
    }
  }
  
  // Update Select All / Unselect All button
  const selectAllBtn = document.getElementById('selectAllBtn');
  if (selectAllBtn && isSelectMode) {
    const visibleCheckboxes = getVisibleCheckboxes();
    const allVisibleSelected = visibleCheckboxes.length > 0 && visibleCheckboxes.every(cb => cb.checked);
    selectAllBtn.textContent = allVisibleSelected ? 'Unselect All' : 'Select All';
    selectAllBtn.onclick = allVisibleSelected ? unselectAllFiles : selectAllFiles;
  }
  
  // Only show the panel when in select mode
  if (isSelectMode) {
    downloadActions.classList.add('show');
    downloadActions.classList.add('sticky');
  } else {
    downloadActions.classList.remove('show');
    downloadActions.classList.remove('sticky');
  }
  
  // Setup haptic feedback for download action buttons
  setupHapticFeedbackForDynamicElements();
}

function getVisibleCheckboxes() {
  // Get all checkboxes that are visible in the current view
  const allCheckboxes = document.querySelectorAll('.item-checkbox');
  const visibleCheckboxes = [];
  
  allCheckboxes.forEach(checkbox => {
    // Check if the checkbox's parent list item is visible (file or folder)
    const listItem = checkbox.closest('li.file-item, li.folder-item');
    
    if (listItem) {
      // Check if the list item is visible
      const style = window.getComputedStyle(listItem);
      const parentUl = listItem.closest('ul');
      
      // Check if list item and its parent ul are visible
      if (style.display !== 'none' && 
          style.visibility !== 'hidden' && 
          (!parentUl || window.getComputedStyle(parentUl).display !== 'none')) {
        visibleCheckboxes.push(checkbox);
      }
    } else {
      // Fallback: if no parent li found, include it if checkbox itself is visible
      const style = window.getComputedStyle(checkbox);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        visibleCheckboxes.push(checkbox);
      }
    }
  });
  
  return visibleCheckboxes;
}

function selectAllFiles() {
  const visibleCheckboxes = getVisibleCheckboxes();
  visibleCheckboxes.forEach(cb => {
    if (!cb.checked) {
      // Set checkbox to checked
      cb.checked = true;
      
      // Trigger the change event to ensure toggleSelection is called
      // This will handle both the selectedFiles Set and visual highlighting
      const changeEvent = new Event('change', { bubbles: true });
      cb.dispatchEvent(changeEvent);
      
      // Also directly update visual state as a backup
      const listItem = cb.closest('.file-item, .folder-item');
      if (listItem) {
        listItem.classList.add('selected');
      }
    }
  });
  updateDownloadActions();
}

function unselectAllFiles() {
  const visibleCheckboxes = getVisibleCheckboxes();
  visibleCheckboxes.forEach(cb => {
    if (cb.checked) {
      // Set checkbox to unchecked
      cb.checked = false;
      
      // Trigger the change event to ensure toggleSelection is called
      // This will handle both the selectedFiles Set and visual highlighting
      const changeEvent = new Event('change', { bubbles: true });
      cb.dispatchEvent(changeEvent);
      
      // Also directly update visual state as a backup
      const listItem = cb.closest('.file-item, .folder-item');
      if (listItem) {
        listItem.classList.remove('selected');
      }
    }
  });
  updateDownloadActions();
}

function exitSelectMode() {
  isSelectMode = false;
  selectedFiles.clear();
  selectedFilesData.clear();
  document.getElementById('selectDownloadBtn').textContent = 'Select Download';
  displayFiles();
}

function enterSelectMode() {
  isSelectMode = true;
  document.getElementById('selectDownloadBtn').textContent = 'Exit Select';
  displayFiles();
}

function toggleFolder(dirPath) {
  // Handle escaped paths from onclick
  const actualPath = dirPath.replace(/\\'/g, "'").replace(/&quot;/g, '"');
  if (expandedFolders.has(actualPath)) {
    expandedFolders.delete(actualPath);
  } else {
    expandedFolders.add(actualPath);
  }
  displayFiles();
}

function navigateToFolder(folderPath) {
  // Handle escaped paths from onclick
  if (folderPath) {
    const actualPath = folderPath.replace(/\\'/g, "'").replace(/&quot;/g, '"');
    currentFolder = actualPath;
    folderStack.push(actualPath);
    // Save current folder to localStorage
    localStorage.setItem('currentFolder', actualPath);
  } else {
    // Navigate to root
    currentFolder = null;
    folderStack = [];
    // Clear saved folder from localStorage
    localStorage.removeItem('currentFolder');
  }
  
  // Clear search when navigating
  document.getElementById('searchInput').value = '';
  
  // Update page title
  updatePageTitle();
  
  loadFiles();
}

function downloadSelected() {
  if (selectedFiles.size === 0) {
    alert('Please select at least one file or folder to download');
    return;
  }
  
  showDownloadConfirmModal();
}

function showDownloadConfirmModal() {
  const pathsArray = Array.from(selectedFiles);
  
  // Build file list HTML
  let totalSize = 0;
  const fileListItems = pathsArray.map(path => {
    const item = allFiles.find(f => f.path === path);
    const data = selectedFilesData.get(path);
    if (data && data.size) totalSize += data.size;
    const icon = item?.type === 'folder' ? '📁' : '📄';
    const name = item?.name || path.split('/').pop();
    const size = data?.size ? formatSize(data.size) : '';
    return `<div class="download-confirm-item">
      <span class="download-confirm-icon">${icon}</span>
      <span class="download-confirm-name">${name}</span>
      <span class="download-confirm-size">${size}</span>
    </div>`;
  }).join('');

  const modalHTML = `
    <div id="downloadConfirmModal" class="modal show">
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h2 class="modal-title">Proceed to download?</h2>
          <button class="modal-close-btn" onclick="closeDownloadConfirmModal()">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom: 12px; color: var(--text-color);">
            You are about to download <strong>${pathsArray.length}</strong> item${pathsArray.length > 1 ? 's' : ''}${totalSize > 0 ? ` (${formatSize(totalSize)} total)` : ''}:
          </p>
          <div class="download-confirm-list">
            ${fileListItems}
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-cancel-btn" onclick="closeDownloadConfirmModal()">Cancel</button>
          <button class="modal-upload-btn" onclick="confirmDownload()">Download</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);
  document.body.style.overflow = 'hidden';

  // Ensure haptic feedback is attached to newly injected modal buttons
  setupHapticFeedbackForDynamicElements();
}

function closeDownloadConfirmModal() {
  const modal = document.getElementById('downloadConfirmModal');
  if (modal) modal.remove();
  document.body.style.overflow = '';
}

function confirmDownload() {
  closeDownloadConfirmModal();
  
  const pathsArray = Array.from(selectedFiles);
  
  if (pathsArray.length === 1) {
    // Single file - use progress download
    const path = pathsArray[0];
    const item = allFiles.find(f => f.path === path);
    if (item) {
      const fileName = item.type === 'folder' ? `${item.name}.zip` : item.name;
      downloadFileWithProgress(path, fileName);
    }
  } else {
    // Multiple files - download sequentially with progress
    downloadMultipleFiles(pathsArray, 0);
  }
  
  setTimeout(() => {
    exitSelectMode();
  }, 500);
}

function downloadMultipleFiles(paths, index) {
  if (index >= paths.length) return;
  
  const path = paths[index];
  const item = allFiles.find(f => f.path === path);
  
  if (item) {
    const fileName = item.type === 'folder' ? `${item.name}.zip` : item.name;
    
    // For multiple files, use direct download to avoid modal spam
    const downloadUrl = `/download/${encodeURIComponent(path)}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Download next file after a short delay
    setTimeout(() => {
      downloadMultipleFiles(paths, index + 1);
    }, 300);
  }
}

function handleSort(sortField) {
  if (currentSort.field === sortField && currentSort.order === 'asc') {
    currentSort.order = 'desc';
  } else {
    currentSort.field = sortField;
    currentSort.order = 'asc';
  }
  
  updateSortUI();
  displayFiles();
}

function updateSortUI() {
  const sortIcon = document.getElementById('sortIcon');
  const sortOptions = document.querySelectorAll('.sort-option[data-sort]');
  
  // Update active state for field options
  sortOptions.forEach(option => {
    option.classList.remove('active');
    if (option.getAttribute('data-sort') === currentSort.field) {
      option.classList.add('active');
    }
  });
  
  // Update main sort button icon
  if (sortIcon) {
    if (currentSort.order === 'asc') {
      sortIcon.src = 'assets/drop-down.png';
    } else {
      sortIcon.src = 'assets/drop-up.png';
    }
  }
}

// Transfer Progress Manager
const TransferManager = {
  modal: null,
  progressBar: null,
  percentageText: null,
  fileNameEl: null,
  speedEl: null,
  etaEl: null,
  transferredEl: null,
  totalEl: null,
  statusMessage: null,
  pauseBtn: null,
  resumeBtn: null,
  cancelBtn: null,
  retryBtn: null,
  doneBtn: null,
  
  // Transfer state
  xhr: null,
  startTime: 0,
  lastLoaded: 0,
  lastTime: 0,
  speedSamples: [],
  peakSpeed: 0,
  
  init() {
    this.createModal();
  },
  
  createModal() {
    // Check if modal already exists
    if (document.getElementById('transferProgressModal')) {
      this.modal = document.getElementById('transferProgressModal');
      this.bindElements();
      return;
    }
    
    const modalHtml = `
      <div id="transferProgressModal" class="transfer-progress-modal">
        <div class="transfer-progress-content">
          <div class="transfer-progress-header">
            <h3 class="transfer-progress-title">
              <span class="transfer-progress-icon">📤</span>
              <span id="transferTitle">Uploading...</span>
            </h3>
            <button class="transfer-progress-close" id="transferCloseBtn" title="Close">×</button>
          </div>
          
          <div class="transfer-file-name" id="transferFileName">filename.ext</div>
          
          <div class="transfer-progress-bar-container">
            <div class="transfer-progress-bar" id="transferProgressBar" style="width: 0%"></div>
            <span class="transfer-progress-percentage" id="transferPercentage">0%</span>
          </div>
          
          <div class="transfer-stats">
            <div class="transfer-stat">
              <div class="transfer-stat-label">Speed</div>
              <div class="transfer-stat-value" id="transferSpeed">-- KB/s</div>
            </div>
            <div class="transfer-stat">
              <div class="transfer-stat-label">Time Left</div>
              <div class="transfer-stat-value" id="transferETA">Calculating...</div>
            </div>
            <div class="transfer-stat">
              <div class="transfer-stat-label">Transferred</div>
              <div class="transfer-stat-value" id="transferTransferred">0 B</div>
            </div>
            <div class="transfer-stat">
              <div class="transfer-stat-label">Total Size</div>
              <div class="transfer-stat-value" id="transferTotal">0 B</div>
            </div>
          </div>
          
          <div class="transfer-status-message info" id="transferStatusMessage" style="display: none;"></div>
          
          <div class="transfer-actions" id="transferActions">
            <button class="transfer-btn transfer-btn-pause" id="transferPauseBtn">
              Pause
            </button>
            <button class="transfer-btn transfer-btn-resume" id="transferResumeBtn" style="display: none;">
              Resume
            </button>
            <button class="transfer-btn transfer-btn-cancel" id="transferCancelBtn">
              Cancel
            </button>
            <button class="transfer-btn transfer-btn-retry" id="transferRetryBtn" style="display: none;">
              Retry
            </button>
            <button class="transfer-btn transfer-btn-done" id="transferDoneBtn" style="display: none;">
              Done
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.modal = document.getElementById('transferProgressModal');
    this.bindElements();
    this.bindEvents();
  },
  
  bindElements() {
    this.progressBar = document.getElementById('transferProgressBar');
    this.percentageText = document.getElementById('transferPercentage');
    this.fileNameEl = document.getElementById('transferFileName');
    this.speedEl = document.getElementById('transferSpeed');
    this.etaEl = document.getElementById('transferETA');
    this.transferredEl = document.getElementById('transferTransferred');
    this.totalEl = document.getElementById('transferTotal');
    this.statusMessage = document.getElementById('transferStatusMessage');
    this.pauseBtn = document.getElementById('transferPauseBtn');
    this.resumeBtn = document.getElementById('transferResumeBtn');
    this.cancelBtn = document.getElementById('transferCancelBtn');
    this.retryBtn = document.getElementById('transferRetryBtn');
    this.doneBtn = document.getElementById('transferDoneBtn');
    this.titleEl = document.getElementById('transferTitle');
    this.iconEl = document.querySelector('.transfer-progress-icon');
    this.closeBtn = document.getElementById('transferCloseBtn');
  },
  
  bindEvents() {
    this.pauseBtn?.addEventListener('click', () => this.pause());
    this.resumeBtn?.addEventListener('click', () => this.resume());
    this.cancelBtn?.addEventListener('click', () => this.cancel());
    this.retryBtn?.addEventListener('click', () => this.retry());
    this.doneBtn?.addEventListener('click', () => this.close());
    this.closeBtn?.addEventListener('click', () => this.close());
  },
  
  show(type = 'upload', fileName = '', totalSize = 0) {
    this.createModal();
    this.reset();
    
    this.titleEl.textContent = type === 'upload' ? 'Uploading...' : 'Downloading...';
    this.iconEl.textContent = type === 'upload' ? '' : '';
    this.fileNameEl.textContent = fileName;
    this.totalEl.textContent = formatSize(totalSize);
    
    this.modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    this.startTime = Date.now();
    this.lastTime = this.startTime;
    this.lastLoaded = 0;
    this.speedSamples = [];
    this.peakSpeed = 0;
  },
  
  reset() {
    isPaused = false;
    isCancelled = false;
    
    this.progressBar.style.width = '0%';
    this.progressBar.classList.remove('paused', 'error');
    this.percentageText.textContent = '0%';
    this.speedEl.textContent = '-- KB/s';
    this.etaEl.textContent = 'Calculating...';
    this.transferredEl.textContent = '0 B';
    
    this.statusMessage.style.display = 'none';
    this.pauseBtn.style.display = 'inline-flex';
    this.resumeBtn.style.display = 'none';
    this.cancelBtn.style.display = 'inline-flex';
    this.retryBtn.style.display = 'none';
    this.doneBtn.style.display = 'none';
  },
  
  updateProgress(loaded, total) {
    if (isCancelled) return;
    
    const percentage = Math.round((loaded / total) * 100);
    this.progressBar.style.width = `${percentage}%`;
    this.percentageText.textContent = `${percentage}%`;
    this.transferredEl.textContent = formatSize(loaded);
    
    // Calculate speed
    const now = Date.now();
    const timeDiff = (now - this.lastTime) / 1000;
    
    if (timeDiff >= 0.5) { // Update every 500ms
      const bytesPerSecond = (loaded - this.lastLoaded) / timeDiff;
      this.speedSamples.push(bytesPerSecond);
      
      // Keep last 5 samples for averaging
      if (this.speedSamples.length > 5) {
        this.speedSamples.shift();
      }
      
      const avgSpeed = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;
      
      // Track peak speed
      if (avgSpeed > this.peakSpeed) {
        this.peakSpeed = avgSpeed;
      }
      
      this.speedEl.textContent = this.formatSpeed(avgSpeed);
      
      // Calculate ETA
      const remaining = total - loaded;
      if (avgSpeed > 0) {
        const etaSeconds = remaining / avgSpeed;
        this.etaEl.textContent = this.formatTime(etaSeconds);
      }
      
      this.lastLoaded = loaded;
      this.lastTime = now;
    }
  },
  
  formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) {
      return `${Math.round(bytesPerSecond)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    } else {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
    }
  },
  
  formatTime(seconds) {
    if (seconds < 60) {
      return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
  },
  
  showStatus(message, type = 'info') {
    this.statusMessage.textContent = message;
    this.statusMessage.className = `transfer-status-message ${type}`;
    this.statusMessage.style.display = 'block';
  },
  
  pause() {
    if (this.xhr && !isPaused) {
      isPaused = true;
      this.progressBar.classList.add('paused');
      this.pauseBtn.style.display = 'none';
      this.resumeBtn.style.display = 'inline-flex';
      this.showStatus('Transfer paused', 'warning');
      // Note: XHR doesn't support true pause, we show paused state
      // For true pause/resume, you'd need chunked uploads with server support
    }
  },
  
  resume() {
    if (isPaused) {
      isPaused = false;
      this.progressBar.classList.remove('paused');
      this.pauseBtn.style.display = 'inline-flex';
      this.resumeBtn.style.display = 'none';
      this.statusMessage.style.display = 'none';
    }
  },
  
  cancel() {
    isCancelled = true;
    if (this.xhr) {
      this.xhr.abort();
    }
    this.progressBar.classList.add('error');
    this.showStatus('Transfer cancelled', 'error');
    this.pauseBtn.style.display = 'none';
    this.resumeBtn.style.display = 'none';
    this.cancelBtn.style.display = 'none';
    this.retryBtn.style.display = 'inline-flex';
    this.doneBtn.style.display = 'inline-flex';
  },
  
  complete(success = true, message = '') {
    if (success) {
      this.progressBar.style.width = '100%';
      this.percentageText.textContent = '100%';
      this.showStatus(message || 'Transfer complete!', 'success');
      this.titleEl.textContent = 'Complete!';
    } else {
      this.progressBar.classList.add('error');
      this.showStatus(message || 'Transfer failed', 'error');
      this.titleEl.textContent = 'Failed';
    }
    
    this.pauseBtn.style.display = 'none';
    this.resumeBtn.style.display = 'none';
    this.cancelBtn.style.display = 'none';
    this.retryBtn.style.display = success ? 'none' : 'inline-flex';
    this.doneBtn.style.display = 'inline-flex';
    
    // Show peak speed on completion
    this.speedEl.textContent = success && this.peakSpeed > 0 
      ? this.formatSpeed(this.peakSpeed) 
      : '--';
    this.etaEl.textContent = success ? 'Done' : '--';
  },
  
  retry() {
    if (activeTransfer) {
      this.reset();
      if (activeTransfer.type === 'upload') {
        handleUploadWithProgress(activeTransfer.files);
      } else {
        downloadFileWithProgress(activeTransfer.path, activeTransfer.name);
      }
    }
  },
  
  close() {
    this.modal.classList.remove('show');
    document.body.style.overflow = '';
    activeTransfer = null;
    if (this.xhr) {
      this.xhr.abort();
      this.xhr = null;
    }
  }
};

function handleUpload() {
  if (filesToUpload.length === 0) {
    return;
  }
  
  // Use the progress-enabled upload
  handleUploadWithProgress(filesToUpload);
}

function handleUploadWithProgress(files) {
  if (!files || files.length === 0) return;
  
  // Calculate total size
  let totalSize = 0;
  for (let i = 0; i < files.length; i++) {
    totalSize += files[i].size;
  }
  
  const fileNames = files.length === 1 
    ? files[0].name 
    : `${files.length} files`;
  
  activeTransfer = { type: 'upload', files: files };
  
  TransferManager.init();
  TransferManager.show('upload', fileNames, totalSize);
  
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  
  const xhr = new XMLHttpRequest();
  TransferManager.xhr = xhr;
  
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable && !isPaused) {
      TransferManager.updateProgress(e.loaded, e.total);
    }
  });
  
  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      TransferManager.complete(true, `Successfully uploaded ${fileNames}`);
      filesToUpload = [];
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.value = '';
      loadFiles();
    } else {
      TransferManager.complete(false, `Upload failed: ${xhr.statusText}`);
    }
  });
  
  xhr.addEventListener('error', () => {
    if (!isCancelled) {
      TransferManager.complete(false, 'Network error occurred');
    }
  });
  
  xhr.addEventListener('abort', () => {
    // Already handled in cancel()
  });
  
  xhr.open('POST', '/');
  xhr.send(formData);
}

function downloadFileWithProgress(filePath, fileName) {
  activeTransfer = { type: 'download', path: filePath, name: fileName };
  
  TransferManager.init();
  TransferManager.show('download', fileName, 0);
  
  const xhr = new XMLHttpRequest();
  TransferManager.xhr = xhr;
  
  xhr.responseType = 'blob';
  
  xhr.addEventListener('progress', (e) => {
    if (e.lengthComputable && !isPaused) {
      if (TransferManager.totalEl.textContent === '0 B') {
        TransferManager.totalEl.textContent = formatSize(e.total);
      }
      TransferManager.updateProgress(e.loaded, e.total);
    }
  });
  
  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      // Create download link
      const blob = xhr.response;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      // Update total size from blob size
      TransferManager.totalEl.textContent = formatSize(blob.size);
      TransferManager.transferredEl.textContent = formatSize(blob.size);
      
      TransferManager.complete(true, `Downloaded ${fileName}`);
    } else {
      TransferManager.complete(false, `Download failed: ${xhr.statusText}`);
    }
  });
  
  xhr.addEventListener('error', () => {
    if (!isCancelled) {
      TransferManager.complete(false, 'Network error occurred');
    }
  });
  
  xhr.open('GET', `/download/${encodeURIComponent(filePath)}`);
  xhr.send();
}

// Theme toggle functionality
function initThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  
  // Load saved theme preference
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // Set initial theme
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    document.body.classList.add('dark-mode');
    themeIcon.src = 'assets/light-mode.png';
    themeIcon.alt = 'Switch to light mode';
  } else {
    document.body.classList.remove('dark-mode');
    themeIcon.src = 'assets/dark-mode.png';
    themeIcon.alt = 'Switch to dark mode';
  }
  
  // Toggle theme on button click
  themeToggle.addEventListener('click', function() {
    const isDarkMode = document.body.classList.toggle('dark-mode');
    
    if (isDarkMode) {
      themeIcon.src = 'assets/light-mode.png';
      themeIcon.alt = 'Switch to light mode';
      localStorage.setItem('theme', 'dark');
    } else {
      themeIcon.src = 'assets/dark-mode.png';
      themeIcon.alt = 'Switch to dark mode';
      localStorage.setItem('theme', 'light');
    }
  });
}

// Update footer links for mobile apps
function updateFooterLinksForMobile() {
  if (!isMobileDevice()) return;
  
  // Facebook link - use app deep link on mobile
  const facebookLink = document.querySelector('.footer-link[aria-label="Facebook"]');
  if (facebookLink) {
    // Store original web URL as data attribute for potential fallback
    const webUrl = facebookLink.getAttribute('href');
    facebookLink.setAttribute('data-web-url', webUrl);
    // Use fb:// scheme for Facebook app (works on both iOS and Android)
    // Try profile first, as it's likely a personal profile
    facebookLink.href = 'fb://profile/jamesakalam';
  }
  
  // Twitter/X link - use app deep link on mobile
  const twitterLink = document.querySelector('.footer-link[aria-label="X (Twitter)"]');
  if (twitterLink) {
    // Store original web URL as data attribute for potential fallback
    const webUrl = twitterLink.getAttribute('href');
    twitterLink.setAttribute('data-web-url', webUrl);
    // Use twitter:// scheme for Twitter/X app (works on both iOS and Android)
    twitterLink.href = 'twitter://user?screen_name=jhamespaul06';
  }
  
  // Instagram link - use app deep link on mobile
  const instagramLink = document.querySelector('.footer-link[aria-label="Instagram"]');
  if (instagramLink) {
    // Store original web URL as data attribute for potential fallback
    const webUrl = instagramLink.getAttribute('href');
    instagramLink.setAttribute('data-web-url', webUrl);
    // Use instagram:// scheme for Instagram app (works on both iOS and Android)
    instagramLink.href = 'instagram://user?username=dyamessu';
  }
}

// Initialize when DOM is ready
function initializeApp() {
  try {
    // Initialize theme toggle
    initThemeToggle();
    
    // Update footer links for mobile apps
    updateFooterLinksForMobile();
    
    // Sort dropdown
    const sortBtn = document.getElementById('sortBtn');
    const sortDropdown = document.getElementById('sortDropdown');
    
    if (sortBtn && sortDropdown) {
      sortBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        sortDropdown.classList.toggle('show');
      });
      
      document.addEventListener('click', function(e) {
        if (!sortBtn.contains(e.target) && !sortDropdown.contains(e.target)) {
          sortDropdown.classList.remove('show');
        }
      });
      
      // Attach listeners to sort options
      const sortOptions = document.querySelectorAll('.sort-option');
      sortOptions.forEach(option => {
        option.addEventListener('click', function() {
          const sortField = this.getAttribute('data-sort');
          handleSort(sortField);
          sortDropdown.classList.remove('show');
        });
      });
    }
    
    // Upload button and modal
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    const uploadModal = document.getElementById('uploadModal');
    const chooseFileBtn = document.getElementById('chooseFileBtn');
    const modalUploadBtn = document.getElementById('modalUploadBtn');
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const fileListToUpload = document.getElementById('fileListToUpload');
    const fileCount = document.getElementById('fileCount');
    
    function closeModal() {
      uploadModal.classList.remove('show');
      filesToUpload = [];
      fileInput.value = '';
      updateFileList();
    }
    
    if (uploadBtn && uploadModal) {
      uploadBtn.addEventListener('click', function() {
        uploadModal.classList.add('show');
        updateFileList();
      });
    }
    
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', closeModal);
    }
    
    if (chooseFileBtn && fileInput) {
      chooseFileBtn.addEventListener('click', function() {
        fileInput.click();
      });
      
      fileInput.addEventListener('change', function() {
        // Add new files to the array (avoiding duplicates)
        const newFiles = Array.from(fileInput.files);
        newFiles.forEach(file => {
          // Check if file already exists (by name and size)
          const exists = filesToUpload.some(existingFile => 
            existingFile.name === file.name && existingFile.size === file.size
          );
          if (!exists) {
            filesToUpload.push(file);
          }
        });
        updateFileList();
        // Reset file input so same file can be selected again if needed
        fileInput.value = '';
      });
    }
    
    if (modalUploadBtn) {
      modalUploadBtn.addEventListener('click', function() {
        if (filesToUpload.length > 0) {
          handleUpload();
          uploadModal.classList.remove('show');
        }
      });
    }
    
    if (modalCancelBtn) {
      modalCancelBtn.addEventListener('click', closeModal);
    }
    
    // Close modal when clicking outside
    if (uploadModal) {
      uploadModal.addEventListener('click', function(e) {
        if (e.target === uploadModal) {
          closeModal();
        }
      });
    }
    
    function updateFileList() {
      fileListToUpload.innerHTML = '';
      
      // Update file count
      if (fileCount) {
        const count = filesToUpload.length;
        fileCount.textContent = count === 1 ? '1 file' : `${count} files`;
      }
      
      // Enable/disable upload button
      if (modalUploadBtn) {
        modalUploadBtn.disabled = filesToUpload.length === 0;
      }
      
      if (filesToUpload.length === 0) {
        const emptyLi = document.createElement('li');
        emptyLi.className = 'empty-state';
        emptyLi.textContent = 'No files selected';
        fileListToUpload.appendChild(emptyLi);
        return;
      }
      
      filesToUpload.forEach((file, index) => {
        const li = document.createElement('li');
        
        const fileName = document.createElement('span');
        fileName.textContent = file.name;
        fileName.style.flex = '1';
        fileName.style.minWidth = '0';
        fileName.style.overflow = 'hidden';
        fileName.style.textOverflow = 'ellipsis';
        fileName.style.whiteSpace = 'nowrap';
        li.appendChild(fileName);
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.style.background = 'transparent';
        removeBtn.style.border = 'none';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.fontSize = '20px';
        removeBtn.style.color = 'var(--text-color)';
        removeBtn.style.opacity = '0.6';
        removeBtn.style.padding = '4px 8px';
        removeBtn.style.borderRadius = '4px';
        removeBtn.style.transition = 'all 0.2s ease';
        removeBtn.style.flexShrink = '0';
        removeBtn.title = 'Remove';
        removeBtn.setAttribute('aria-label', 'Remove file');
        removeBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          filesToUpload.splice(index, 1);
          updateFileList();
        });
        
        // Attach haptic feedback to remove button
        attachHapticFeedback(removeBtn);
        removeBtn.addEventListener('mouseenter', function() {
          this.style.color = '#f44336';
          this.style.opacity = '1';
        });
        removeBtn.addEventListener('mouseleave', function() {
          this.style.color = 'var(--text-color)';
          this.style.opacity = '0.6';
          this.style.backgroundColor = 'transparent';
        });
        
        li.appendChild(removeBtn);
        fileListToUpload.appendChild(li);
      });
      
      // Setup haptic feedback for all buttons in the list
      setupHapticFeedbackForDynamicElements();
    }
    
    // Select Download button
    const selectDownloadBtn = document.getElementById('selectDownloadBtn');
    if (selectDownloadBtn) {
      selectDownloadBtn.addEventListener('click', function() {
        if (isSelectMode) {
          exitSelectMode();
        } else {
          enterSelectMode();
        }
      });
    }
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    let searchTimeout;
    
    function updateClearButton() {
      if (searchClearBtn && searchInput) {
        searchClearBtn.style.display = searchInput.value.trim().length > 0 ? 'flex' : 'none';
      }
    }
    
    function clearSearch() {
      if (searchInput) {
        searchInput.value = '';
        updateClearButton();
        
        // Clear any pending search timeout
        if (searchTimeout) {
          clearTimeout(searchTimeout);
          searchTimeout = null;
        }
        
        // Reload files to show folders if in root, or refresh current view
        if (!currentFolder) {
          loadFiles();
        } else {
          displayFiles();
        }
      }
    }
    
    if (searchInput) {
      // Show/hide clear button based on input value
      searchInput.addEventListener('input', function() {
        updateClearButton();
        
        const searchTerm = this.value.toLowerCase().trim();
        const isSearchingInRoot = !currentFolder;
        
        // If in root view, reload files when search term changes
        // (to switch between folder view and file search)
        if (isSearchingInRoot) {
          // Clear previous timeout
          if (searchTimeout) {
            clearTimeout(searchTimeout);
          }
          // Debounce the search to avoid too many requests
          searchTimeout = setTimeout(() => {
            loadFiles();
            searchTimeout = null;
          }, 300);
        } else {
          // In folder view, just filter the current view
          displayFiles();
        }
      });
      
      // Initial state
      updateClearButton();
    }
    
    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        clearSearch();
        // Focus back on the input after clearing
        if (searchInput) {
          searchInput.focus();
        }
      });
    }
    
    // Image preview modal close handlers
    const imagePreviewModal = document.getElementById('imagePreviewModal');
    const imagePreviewClose = document.getElementById('imagePreviewClose');
    
    if (imagePreviewClose) {
      imagePreviewClose.addEventListener('click', hideImagePreview);
    }
    
    if (imagePreviewModal) {
      // Close modal when clicking outside the image
      imagePreviewModal.addEventListener('click', function(e) {
        if (e.target === imagePreviewModal) {
          hideImagePreview();
        }
      });
      
      // Close modal on Escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && imagePreviewModal.classList.contains('show')) {
          hideImagePreview();
        }
      });
    }
    
    // Media player modal close handlers
    const mediaPlayerModal = document.getElementById('mediaPlayerModal');
    const mediaPlayerClose = document.getElementById('mediaPlayerClose');
    
    if (mediaPlayerClose) {
      mediaPlayerClose.addEventListener('click', hideMediaPlayer);
    }
    
    if (mediaPlayerModal) {
      // Close modal when clicking outside the player
      mediaPlayerModal.addEventListener('click', function(e) {
        if (e.target === mediaPlayerModal) {
          hideMediaPlayer();
        }
      });
      
      // Close modal on Escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && mediaPlayerModal.classList.contains('show')) {
          hideMediaPlayer();
        }
      });
    }
    
    // Document preview modal close handlers
    const documentPreviewModal = document.getElementById('documentPreviewModal');
    const documentPreviewClose = document.getElementById('documentPreviewClose');
    
    if (documentPreviewClose) {
      documentPreviewClose.addEventListener('click', hideDocumentPreview);
    }
    
    if (documentPreviewModal) {
      // Close modal when clicking outside the preview
      documentPreviewModal.addEventListener('click', function(e) {
        if (e.target === documentPreviewModal) {
          hideDocumentPreview();
        }
      });
      
      // Close modal on Escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && documentPreviewModal.classList.contains('show')) {
          hideDocumentPreview();
        }
      });
    }
    
    // Restore current folder from localStorage before initial load
    const savedFolder = localStorage.getItem('currentFolder');
    if (savedFolder) {
      currentFolder = savedFolder;
      // Rebuild folder stack from saved folder path
      const pathParts = savedFolder.split('/').filter(p => p);
      folderStack = [];
      let currentPath = '';
      pathParts.forEach(part => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        folderStack.push(currentPath);
      });
    }
    
    // Initial load
    loadFiles();
    updateSortUI();
    updatePageTitle(); // Set initial title
    
    // Setup haptic feedback for static elements
    setupHapticFeedbackForDynamicElements();
    
    // Setup haptic feedback when modal opens
    if (uploadModal) {
      const observer = new MutationObserver(function(mutations) {
        if (uploadModal.classList.contains('show')) {
          // Small delay to ensure DOM is updated
          setTimeout(() => {
            setupHapticFeedbackForDynamicElements();
          }, 100);
        }
      });
      observer.observe(uploadModal, { attributes: true, attributeFilter: ['class'] });
    }
  } catch (error) {
    console.error('Error initializing app:', error);
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM is already ready
  initializeApp();
}
