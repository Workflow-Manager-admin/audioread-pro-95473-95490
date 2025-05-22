/**
 * Document Storage Utility
 * 
 * Handles saving, retrieving, adding, and removing documents from localStorage
 * Enhanced with support for pagination state and reading position tracking
 */

const STORAGE_KEY = 'audioReadPro_documents';
const ACTIVE_DOC_KEY = 'audioReadPro_activeDocument';
const POSITION_KEY_PREFIX = 'audioReadProPosition_';
const BOOKMARK_KEY_PREFIX = 'audioReadProBookmarks_';

/**
 * Generate a unique ID for a document
 * @returns {string} A unique ID
 */
const generateDocumentId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

/**
 * Save all documents to localStorage
 * @param {Array} documents - Array of document objects to save
 * @returns {boolean} Success status
 */
export const saveDocuments = (documents) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
    return true;
  } catch (error) {
    console.error('Failed to save documents to localStorage:', error);
    return false;
  }
};

/**
 * Get all documents from localStorage
 * @returns {Array} Array of document objects, or empty array if none found
 */
export const getDocuments = () => {
  try {
    const documents = localStorage.getItem(STORAGE_KEY);
    return documents ? JSON.parse(documents) : [];
  } catch (error) {
    console.error('Failed to get documents from localStorage:', error);
    return [];
  }
};

/**
 * Add a new document to localStorage
 * @param {Object} documentData - Document object with text, title, etc.
 * @returns {Object|null} The added document with ID, or null if failed
 */
export const addDocument = (documentData) => {
  try {
    const documents = getDocuments();
    const newDocument = {
      ...documentData,
      id: generateDocumentId(),
      dateAdded: new Date().toISOString(),
    };
    
    // Make sure the document has the required fields
    if (!newDocument.text || !newDocument.title) {
      console.error('Document must have text and title');
      return null;
    }
    
    // Remove textChunks as they'll be generated on demand
    delete newDocument.textChunks;
    
    documents.push(newDocument);
    const success = saveDocuments(documents);
    return success ? newDocument : null;
  } catch (error) {
    console.error('Failed to add document:', error);
    return null;
  }
};

/**
 * Remove a document from localStorage
 * @param {string} documentId - ID of the document to remove
 * @returns {boolean} Success status
 */
export const removeDocument = (documentId) => {
  try {
    const documents = getDocuments();
    const updatedDocuments = documents.filter(doc => doc.id !== documentId);
    
    if (documents.length === updatedDocuments.length) {
      return false; // Document not found
    }
    
    saveDocuments(updatedDocuments);
    
    // If we removed the active document, clear that reference
    const activeDocId = getActiveDocumentId();
    if (activeDocId === documentId) {
      setActiveDocumentId(updatedDocuments[0]?.id || null);
    }
    
    // Clean up any associated reading position and bookmarks
    removeReadingPosition(documentId);
    removeBookmarks(documentId);
    
    return true;
  } catch (error) {
    console.error('Failed to remove document:', error);
    return false;
  }
};

/**
 * Get a document by ID
 * @param {string} documentId - ID of the document to get
 * @returns {Object|null} The document, or null if not found
 */
export const getDocumentById = (documentId) => {
  try {
    const documents = getDocuments();
    return documents.find(doc => doc.id === documentId) || null;
  } catch (error) {
    console.error('Failed to get document:', error);
    return null;
  }
};

/**
 * Set the active document ID in localStorage
 * @param {string|null} documentId - ID of the active document, or null to clear
 * @returns {boolean} Success status
 */
export const setActiveDocumentId = (documentId) => {
  try {
    if (documentId) {
      localStorage.setItem(ACTIVE_DOC_KEY, documentId);
    } else {
      localStorage.removeItem(ACTIVE_DOC_KEY);
    }
    return true;
  } catch (error) {
    console.error('Failed to set active document:', error);
    return false;
  }
};

/**
 * Get the active document ID from localStorage
 * @returns {string|null} The active document ID, or null if none set
 */
export const getActiveDocumentId = () => {
  try {
    return localStorage.getItem(ACTIVE_DOC_KEY);
  } catch (error) {
    console.error('Failed to get active document ID:', error);
    return null;
  }
};

/**
 * Get the active document from localStorage
 * @returns {Object|null} The active document, or null if none set
 */
export const getActiveDocument = () => {
  const activeDocId = getActiveDocumentId();
  if (!activeDocId) return null;
  
  return getDocumentById(activeDocId);
};

/**
 * Check if there are any documents in localStorage
 * @returns {boolean} True if there are documents, false otherwise
 */
export const hasDocuments = () => {
  return getDocuments().length > 0;
};

/**
 * Save a reading position for a document
 * @param {string} documentId - ID of the document
 * @param {Object} positionData - Position data (page, chunk, position)
 * @returns {boolean} Success status
 */
export const saveReadingPosition = (documentId, positionData) => {
  try {
    if (!documentId || !positionData) return false;
    
    const positionKey = `${POSITION_KEY_PREFIX}${documentId}`;
    localStorage.setItem(positionKey, JSON.stringify({
      ...positionData,
      timestamp: new Date().toISOString()
    }));
    return true;
  } catch (error) {
    console.error('Failed to save reading position:', error);
    return false;
  }
};

/**
 * Get the reading position for a document
 * @param {string} documentId - ID of the document
 * @returns {Object|null} Position data, or null if not found
 */
export const getReadingPosition = (documentId) => {
  try {
    if (!documentId) return null;
    
    const positionKey = `${POSITION_KEY_PREFIX}${documentId}`;
    const positionData = localStorage.getItem(positionKey);
    return positionData ? JSON.parse(positionData) : null;
  } catch (error) {
    console.error('Failed to get reading position:', error);
    return null;
  }
};

/**
 * Remove the reading position for a document
 * @param {string} documentId - ID of the document
 * @returns {boolean} Success status
 */
export const removeReadingPosition = (documentId) => {
  try {
    if (!documentId) return false;
    
    const positionKey = `${POSITION_KEY_PREFIX}${documentId}`;
    localStorage.removeItem(positionKey);
    return true;
  } catch (error) {
    console.error('Failed to remove reading position:', error);
    return false;
  }
};

/**
 * Save bookmarks for a document
 * @param {string} documentId - ID of the document
 * @param {Array} bookmarks - Array of bookmark objects
 * @returns {boolean} Success status
 */
export const saveBookmarks = (documentId, bookmarks) => {
  try {
    if (!documentId || !bookmarks) return false;
    
    const bookmarkKey = `${BOOKMARK_KEY_PREFIX}${documentId}`;
    localStorage.setItem(bookmarkKey, JSON.stringify(bookmarks));
    return true;
  } catch (error) {
    console.error('Failed to save bookmarks:', error);
    return false;
  }
};

/**
 * Get bookmarks for a document
 * @param {string} documentId - ID of the document
 * @returns {Array} Array of bookmark objects, or empty array if none found
 */
export const getBookmarks = (documentId) => {
  try {
    if (!documentId) return [];
    
    const bookmarkKey = `${BOOKMARK_KEY_PREFIX}${documentId}`;
    const bookmarks = localStorage.getItem(bookmarkKey);
    return bookmarks ? JSON.parse(bookmarks) : [];
  } catch (error) {
    console.error('Failed to get bookmarks:', error);
    return [];
  }
};

/**
 * Remove bookmarks for a document
 * @param {string} documentId - ID of the document
 * @returns {boolean} Success status
 */
export const removeBookmarks = (documentId) => {
  try {
    if (!documentId) return false;
    
    const bookmarkKey = `${BOOKMARK_KEY_PREFIX}${documentId}`;
    localStorage.removeItem(bookmarkKey);
    return true;
  } catch (error) {
    console.error('Failed to remove bookmarks:', error);
    return false;
  }
};

/**
 * Update the document metadata (like pageCount, etc.)
 * @param {string} documentId - ID of the document to update
 * @param {Object} metadata - New metadata to update
 * @returns {Object|null} The updated document, or null if failed
 */
export const updateDocumentMetadata = (documentId, metadata) => {
  try {
    const documents = getDocuments();
    const documentIndex = documents.findIndex(doc => doc.id === documentId);
    
    if (documentIndex === -1) return null;
    
    // Create an updated document with the new metadata
    const updatedDocument = {
      ...documents[documentIndex],
      ...metadata,
      lastUpdated: new Date().toISOString()
    };
    
    // Update the document in the array
    documents[documentIndex] = updatedDocument;
    
    // Save the updated documents array
    const success = saveDocuments(documents);
    return success ? updatedDocument : null;
  } catch (error) {
    console.error('Failed to update document metadata:', error);
    return null;
  }
};
