import React from 'react';
import { useDropzone } from 'react-dropzone';
import { FaTrash, FaFileAlt } from 'react-icons/fa';

/**
 * Document Library Component
 * Displays a list of documents and provides UI for adding/removing documents
 */
const DocumentLibrary = ({ 
  documents,
  activeDocument,
  onAddDocument,
  onRemoveDocument,
  onSelectDocument,
  loading
}) => {
  // Setup dropzone for file uploads
  const { getRootProps, getInputProps } = useDropzone({
    onDrop: onAddDocument,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt']
    },
    multiple: false
  });

  return (
    <div className="document-library">
      <h3>Document Library</h3>
      
      <div {...getRootProps({ className: 'upload-document-zone' })}>
        <input {...getInputProps()} />
        <p>Upload Document</p>
      </div>
      
      {loading && <p className="loading-text">Loading...</p>}
      
      <div className="document-list">
        {documents.length === 0 ? (
          <p className="empty-library-message">No documents in your library</p>
        ) : (
          documents.map(doc => (
            <div 
              key={doc.id} 
              className={`document-item ${activeDocument && activeDocument.id === doc.id ? 'active' : ''}`}
              onClick={() => onSelectDocument(doc.id)}
            >
              <div className="document-icon">
                <FaFileAlt />
              </div>
              <div className="document-info">
                <div className="document-title">{doc.title}</div>
                <div className="document-meta">
                  {doc.pageCount > 1 ? `${doc.pageCount} pages` : '1 page'} · {doc.type.toUpperCase()}
                </div>
              </div>
              <button 
                className="document-remove-btn" 
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveDocument(doc.id);
                }}
                aria-label={`Remove ${doc.title}`}
              >
                <FaTrash />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DocumentLibrary;
