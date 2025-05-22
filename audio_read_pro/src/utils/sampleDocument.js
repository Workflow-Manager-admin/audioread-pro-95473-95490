/**
 * Sample Document Utility
 * 
 * Provides a default sample document when the app is first loaded
 */

export const getSampleDocument = () => ({
  title: "Welcome to AudioRead Pro",
  text: "Welcome to AudioRead Pro\n\nAudioRead Pro converts your documents into speech, making it easier to consume written content while on the go or when your eyes need a rest.\n\nFeatures\n\nAudioRead Pro comes with a variety of features to enhance your reading experience:\n\n1. Text-to-Speech Conversion: Convert any text document to spoken audio.\n2. Document Management: Add, remove, and select documents from your library.\n3. Playback Controls: Play, pause, and navigate through your audio content.\n4. Bookmarking: Save your spot with bookmarks for later listening.\n5. Voice Selection: Choose from a variety of voices for your reading experience.\n6. Speed Control: Adjust the reading speed to your preference.\n\nGetting Started\n\nTo get started, you can:\n- Click on documents in your library to select them for reading\n- Upload new documents using the Upload Document button\n- Remove documents you no longer need\n\nTry clicking on different words in this document to have the system start reading from that position.\n\nDocument Types\n\nAudioRead Pro supports the following document formats:\n- PDF files (.pdf)\n- Microsoft Word documents (.docx)\n- Plain text files (.txt)\n\nThanks for using AudioRead Pro. We hope it enhances your reading experience!",
  pageCount: 1,
  dateAdded: new Date().toISOString(),
  type: 'txt',
  textChunks: []  // Will be generated when added
});
