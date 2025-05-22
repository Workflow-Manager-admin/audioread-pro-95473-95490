/**
 * Document Storage Utility
 * 
 * Handles saving, retrieving, adding, and removing documents from localStorage
 */

const STORAGE_KEY = 'audioReadPro_documents';
const ACTIVE_DOC_KEY = 'audioReadPro_activeDocument';

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
