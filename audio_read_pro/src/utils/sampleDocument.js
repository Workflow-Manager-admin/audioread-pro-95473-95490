/**
 * Sample Document Utility
 * 
 * Provides a default sample document when the app is first loaded
 */

export const getSampleDocument = () => ({
  title: "Welcome to AudioRead Pro",
  text: `# Welcome to AudioRead Pro

AudioRead Pro converts your documents into speech, making it easier to consume written content while on the go or when your eyes need a rest.

## Features

AudioRead Pro comes with a variety of features to enhance your reading experience:

1. **Text-to-Speech Conversion**: Convert any text document to spoken audio.
2. **Document Management**: Add, remove, and select documents from your library.
3. **Playback Controls**: Play, pause, and navigate through your audio content.
4. **Bookmarking**: Save your spot with bookmarks for later listening.
5. **Voice Selection**: Choose from a variety of voices for your reading experience.
6. **Speed Control**: Adjust the reading speed to your preference.

## Getting Started

To get started, you can:
- Click on documents in your library to select them for reading
- Upload new documents using the Upload Document button
- Remove documents you no longer need

Try clicking on different words in this document to have the system start reading from that position.

## Document Types

AudioRead Pro supports the following document formats:
- PDF files (.pdf)
- Microsoft Word documents (.docx)
- Plain text files (.txt)

Thanks for using AudioRead Pro. We hope it enhances your reading experience!`,
  pageCount: 1,
  dateAdded: new Date().toISOString(),
  type: 'txt'
});
