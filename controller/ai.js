require('dotenv').config();
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const { AIData, history } = require("../dbmodels/aiDb.js");
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const fd = require('fs');
const path = require('path');
const mime = require('mime-types')


function fileToGenerativePart(path, mimeType) {
    return {
        inlineData: {
            data: Buffer.from(fd.readFileSync(path)).toString("base64"),
            mimeType
        },
    };
}
function formatText(text) {
    // Bold text: **text** or __text__
    text = text.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    // Italic text: *text* or _text_
    text = text.replace(/\* (.*?)\* |_(.*?)_/g, '<em>$1$2</em>');
    // Strikethrough text: ~~text~~
    text = text.replace(/~~(.*?)~~/g, '<s>$1</s>');
    // Monospace text: `text`
    text = text.replace(/`(.*?)`/g, '<code>$1</code>');
    // Blockquotes: > text
    text = text.replace(/^> (.*)/gm, '<blockquote>$1</blockquote>');
    // Ordered lists: 1. text
    text = text.replace(/^(\d+\..*?$)/gm, '<ol>$1</ol>');
    // Unordered lists: - text or + text or * text
    text = text.replace(/^(-|\+|\*).*?$/gm, '<ul>$&</ul>');
    // Horizontal rules: ---
    text = text.replace(/^\s*---\s*$/gm, '<hr>');
    // Links: [text](URL)
    text = text.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
    // Images: ![alt text](image URL)
    text = text.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1">');
    // Code blocks: ```
    text = text.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
    // Inline code: `text`
    text = text.replace(/`(.*?)`/g, '<code>$1</code>');
    // Tables: | Header 1 | Header 2 |
    text = text.replace(/^\|(.*?)\|$/gm, '<table><tr>$1</tr></table>');
    // Adjust spacing to remove overspacing
    text = text.replace(/\n\s*\n/g, '\n');
    // Wrap text in <p> tags to preserve whitespace and line breaks
    text = '<p>' + text.replace(/\n/g, '</p><p>') + '</p>';
    return text;
}


module.exports.index = async (req, res) => {
    res.render("main/ai.ejs");
}

module.exports.answer = async (req, res) => {
    let { input } = req.body.ai;
    const _id = req.body._id;
    input = input.toLowerCase();

    if (req.file) {
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        const mimeType = mime.lookup(fileExtension);

        if (mimeType && mimeType.startsWith('image')) {
            // Handle image file
            const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
            const url = req.file.path;
            const filename = req.file.filename;
            const aiData = new AIData({
                file: {
                    url: url,
                    filename: filename
                }
            });
            const imagePart = fileToGenerativePart(url, mimeType);
            const prompt = input;
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();
            console.log(text);
            await aiData.save();
            return res.send(formatText(text));
        } else if (mimeType && mimeType === 'application/pdf') {
            // Handle PDF file
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            let url = req.file.path;
            let filename = req.file.filename;
            const pdfPath = path.join(__dirname, '..', 'uploads', filename);
            const data = await fs.readFile(pdfPath);
            const pdfData = await pdfParse(data);
            console.log(pdfData.text);
            const aiData = new AIData({
                file: {
                    url: url,
                    filename: filename
                }
            });
            const prompt = `${input} from \n${pdfData.text}`;
            const result = await model.generateContentStream(prompt);
            let text = '';
            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                console.log(chunkText);
                text += chunkText;
            }
            console.log(aiData);
            await aiData.save();
            console.log(text);
            return res.send(formatText(text));
        } else {
            return res.status(400).send("Unsupported file type");
        }
    } else {
        let chatHs;
        if (_id) {
            // Check if there's an existing chat history for the given _id
            chatHs = await history.findById(_id);
        }

        if (!chatHs) {
            // If no chat history found, create a new one
            chatHs = new history({
                history: [
                    {
                        role: 'user',
                        parts: input
                    }
                ]
            });
        } else {
            // If chat history found, append to it
            chatHs.history.push({ role: 'user', parts: input });
        }
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const prompt = input;
        const result = await model.generateContentStream(prompt);
        let text = '';
        for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            console.log(chunkText);
            text += chunkText;
        }
        chatHs.history.push({ role: 'model', parts: text });
        await chatHs.save();
        console.log(chatHs);
        res.render('aiChat.ejs', { text, input, chatHs});
    }
};
