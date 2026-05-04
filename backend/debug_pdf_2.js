const { PDFParse } = require('pdf-parse');
console.log("PDFParse:", PDFParse);
// Often new versions have a static method or you instantiate it
try {
    const parser = new PDFParse();
    console.log("parser instance methods:", Object.keys(Object.getPrototypeOf(parser)));
} catch (e) {
    console.log("Could not instantiate PDFParse:", e.message);
}
