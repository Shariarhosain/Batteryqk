import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log(`Multer middleware initialized in directory: ${__dirname}`);

 const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
//const UPLOAD_DIR = process.env.UPLOAD_DIR;

console.log(`Upload directory set to: ${UPLOAD_DIR}`);

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Error: File upload only supports the following filetypes - ' + allowedTypes), false);
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 2.5 * 1024 * 1024 }, // 2.5MB
  fileFilter: fileFilter,
});

const getFileUrl = (filename) => {
    // Assuming your server serves static files from /uploads route mapped to UPLOAD_DIR
    // Adjust the base URL as per your server configuration
    return `${process.env.APP_BASE_URL || 'http://localhost:3000'}/uploads/${filename}`;
};

// Function to delete a file
const deleteFile = (filename) => {
    const filePath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`Successfully deleted ${filePath}`);
            return true;
        } catch (err) {
            console.error(`Error deleting file ${filePath}:`, err);
            return false;
        }
    } else {
        console.warn(`File not found, cannot delete: ${filePath}`);
        return false;
    }
};


export { upload, getFileUrl, deleteFile, UPLOAD_DIR };