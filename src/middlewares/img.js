import multer from 'multer';

// Configure multer for memory storage (no file saving)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 250 * 1024 * 1024 // 250MB limit
    }
});

// Configure multer for multiple image fields
const uploadImages = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 250 * 1024 * 1024 // 250MB limit
    }
}).fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'sub_images', maxCount: 10 }
]);



// const uploadImageFromClient = async (files) => {
//     try {
//         const formData = new FormData();
        
//         // Handle main image
//         if (files.main_image && files.main_image[0]) {
//             const mainFile = files.main_image[0];
//             if (mainFile.buffer) {
//                 const blob = new Blob([mainFile.buffer], { type: mainFile.mimetype });
//                 formData.append('main_image', blob, mainFile.originalname);
//             } else {
//                 formData.append('main_image', mainFile);
//             }
//         }
        
//         // Handle sub images with same name as main image
//         if (files.sub_images && files.main_image && files.main_image[0]) {
//             const mainImageName = files.main_image[0].originalname;
//             const mainImageBaseName = mainImageName.split('.')[0]; // Get name without extension
            
//             files.sub_images.forEach((subFile, index) => {
//                 const extension = subFile.originalname.split('.').pop();
//                 const newName = `${mainImageBaseName}_sub_${index + 1}.${extension}`;
                
//                 if (subFile.buffer) {
//                     const blob = new Blob([subFile.buffer], { type: subFile.mimetype });
//                     formData.append('sub_images', blob, newName);
//                 } else {
//                     formData.append('sub_images', subFile, newName);
//                 }
//             });
//         }
        
//         console.log('Uploading images with main image name base');

//         const response = await fetch('http://q0c040w8s4gcc40kso48cog0.147.93.111.102.sslip.io/upload', {
//             method: 'POST',
//             body: formData,
//         });
        
//         const data = await response.json();
//         if (!response.ok) {
//             throw new Error(data.error || 'Image upload failed');
//         }
        
        
//         return {
//             success: true,
//             data: data
//         };
//     } catch (error) {
//         console.error('Upload failed:', error.message);
//         return {
//             success: false,
//             error: error.message
//         };
//     }
// };

// Export multer middleware for use in routes
export {  upload, uploadImages };


