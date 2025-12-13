let allFiles = [];
let currentSort = { field: 'name', order: 'asc' };
let selectedFiles = new Set(); // Stores paths
let selectedFilesData = new Map(); // Stores path -> {type, size} for size calculation
let isSelectMode = false;
let expandedFolders = new Set(['.']); // Root folder expanded by default
let filesToUpload = []; // Array to store files selected for upload
let currentFolder = null; // Track the currently selected main folder
let folderStack = []; // Track navigation history for breadcrumbs

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
  
  // Check if file is an image
  if (fileName && isImageFile(fileName)) {
    const fileSize = file ? file.size : null;
    showImagePreview(filePath, fileName, fileSize);
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
            ${!isSelectMode ? `<a href="${downloadUrl}" class="download-btn" download="${escapedName}">Download</a>` : ''}
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
            ${!isSelectMode ? `<a href="${downloadUrl}" class="download-btn" download="${escapedName}">Download</a>` : ''}
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
          ${!isSelectMode ? `<a href="${downloadUrl}" class="download-btn" download="${escapedName}">Download</a>` : ''}
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
  } else {
    downloadActions.classList.remove('show');
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
  } else {
    // Navigate to root
    currentFolder = null;
    folderStack = [];
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
  
  selectedFiles.forEach(path => {
    const item = allFiles.find(f => f.path === path);
    if (item) {
      const downloadUrl = `/download/${encodeURIComponent(path)}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      // For folders, the server will return a ZIP file, so add .zip extension
      link.download = item.type === 'folder' ? `${item.name}.zip` : item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });
  
  setTimeout(() => {
    exitSelectMode();
  }, 500);
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

function handleUpload() {
  if (filesToUpload.length === 0) {
    return;
  }
  
  const statusDiv = document.getElementById('uploadStatus');
  statusDiv.className = 'upload-status info';
  statusDiv.innerHTML = `<p>Uploading ${filesToUpload.length} file(s)...</p>`;
  
  const formData = new FormData();
  for (let i = 0; i < filesToUpload.length; i++) {
    formData.append('files', filesToUpload[i]);
  }
  
  fetch('/', {
    method: 'POST',
    body: formData
  })
    .then(response => response.text())
    .then(data => {
      statusDiv.className = 'upload-status success';
      statusDiv.innerHTML = `<p>${data}</p>`;
      filesToUpload = [];
      const fileInput = document.getElementById('fileInput');
      fileInput.value = '';
      loadFiles();
      setTimeout(() => {
        statusDiv.innerHTML = '';
        statusDiv.className = '';
      }, 3000);
    })
    .catch(error => {
      statusDiv.className = 'upload-status error';
      statusDiv.innerHTML = `<p>Upload failed: ${error.message}</p>`;
    });
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

// Initialize when DOM is ready
function initializeApp() {
  try {
    // Initialize theme toggle
    initThemeToggle();
    
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
