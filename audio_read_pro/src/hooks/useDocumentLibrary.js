import { useState, useEffect, useCallback } from 'react';
import { 
  getDocuments,
  addDocument,
  removeDocument,
  getActiveDocument,
  setActiveDocumentId,
  hasDocuments
} from '../utils/documentStorage';
import { getSampleDocument } from '../utils/sampleDocument';
import { processDocument } from '../utils/documentUtils';

/**
 * Custom hook to manage the document library
 * Provides functionality to add, remove, list, and select documents
 */
const useDocumentLibrary = () => {
  const [documents, setDocuments] = useState([]);
  const [activeDocument, setActiveDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load documents from localStorage on mount
  useEffect(() => {
    // Using a non-async function for the effect to avoid potential issues
    const initializeDocuments = () => {
      try {
        setLoading(true);
        // Get documents from localStorage
        const storedDocuments = getDocuments();
        
        // If no documents, create and add sample document
        if (!hasDocuments()) {
          const sampleDoc = getSampleDocument();
          const addedSampleDoc = addDocument(sampleDoc);
          
          // Set as active document
          if (addedSampleDoc) {
            setActiveDocumentId(addedSampleDoc.id);
            setDocuments([addedSampleDoc]);
            setActiveDocument(addedSampleDoc);
          }
        } else {
          setDocuments(storedDocuments);
          
          // Get the active document
          const activeDoc = getActiveDocument();
          
          // If active document exists, set it
          if (activeDoc) {
            setActiveDocument(activeDoc);
          } else if (storedDocuments.length > 0) {
            // Otherwise default to first document
            setActiveDocumentId(storedDocuments[0].id);
            setActiveDocument(storedDocuments[0]);
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error initializing documents:', err);
        setError('Failed to load documents');
      } finally {
        setLoading(false);
      }
    };
    
    // Execute the initialization
    initializeDocuments();
  }, []);

  /**
   * Add a new document to the library
   * @param {File} file - The file to add
   * @returns {Promise<Object>} The added document
   */
  const addNewDocument = useCallback(async (file) => {
    try {
      setError(null);
      setLoading(true);
      
      // Process the document to extract text and page count
      const { text, pageCount } = await processDocument(file);
      
      // Prepare document data
      const documentData = {
        title: file.name,
        text,
        pageCount,
        type: file.name.split('.').pop().toLowerCase()
      };
      
      // Add to storage
      const newDocument = addDocument(documentData);
      
      // Update state if document was added successfully
      if (newDocument) {
        setDocuments(prev => [...prev, newDocument]);
        return newDocument;
      } else {
        throw new Error('Failed to add document to storage');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error adding document:', err);
      setError(`Failed to add document: ${err.message}`);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Remove a document from the library
   * @param {string} documentId - ID of the document to remove
   * @returns {boolean} Success status
   */
  const removeDocumentFromLibrary = useCallback((documentId) => {
    try {
      setError(null);
      
      // Remove from storage
      const success = removeDocument(documentId);
      
      if (success) {
        // Update state
        setDocuments(prev => prev.filter(doc => doc.id !== documentId));
        
        // If the active document was removed, set a new active document
        if (activeDocument && activeDocument.id === documentId) {
          const remainingDocs = getDocuments();
          if (remainingDocs.length > 0) {
            setActiveDocumentId(remainingDocs[0].id);
            setActiveDocument(remainingDocs[0]);
          } else {
            setActiveDocument(null);
          }
        }
      }
      
      return success;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error removing document:', err);
      setError(`Failed to remove document: ${err.message}`);
      return false;
    }
  }, [activeDocument]);

  /**
   * Set a document as the active document
   * @param {string} documentId - ID of the document to set as active
   * @returns {Object|null} The active document or null if not found
   */
  const setActiveDocumentById = useCallback((documentId) => {
    try {
      setError(null);
      
      // Find the document in our current state
      const document = documents.find(doc => doc.id === documentId);
      
      if (!document) {
        setError('Document not found');
        return null;
      }
      
      // Set as active in storage
      setActiveDocumentId(documentId);
      
      // Update state
      setActiveDocument(document);
      
      return document;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error setting active document:', err);
      setError(`Failed to set active document: ${err.message}`);
      return null;
    }
  }, [documents]);

  return {
    documents,
    activeDocument,
    loading,
    error,
    addNewDocument,
    removeDocumentFromLibrary,
    setActiveDocumentById
  };
};

export default useDocumentLibrary;
