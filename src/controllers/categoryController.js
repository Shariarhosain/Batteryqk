import categoryService from '../services/categoryService.js';
import { getLanguage, translate } from '../utils/i18n.js'; // Ensure these are correctly exported from your i18n utility

const categoryController = {
 async createCategory(req, res, next) {
  const lang = getLanguage(req);
  try {
    const reqDetails = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      actorUserId: req.user?.id,
    };

    const newCategory = await categoryService.createCategory(req.body, lang, reqDetails); // Will be a single object

    if (!newCategory) { // Should ideally not happen if service throws errors for failures
        return res.status(400).json({ message: translate('category_creation_failed', lang) });
    }
    
    res.status(201).json({
      message: translate('category_created', lang, { name: newCategory.mainCategory || newCategory.id }),
      data: newCategory, // Single object
    });
  } catch (error) {
    console.error("Error in categoryController.createCategory:", error.message, error.stack);
    next(error);
  }
},
  async getAllCategories(req, res, next) {
    const lang = getLanguage(req);
    try {
      // Pass lang to the service for i18n handling
      const categories = await categoryService.getAllCategories(lang);
      res.status(200).json(categories);
    } catch (error) {
      console.error("Error in categoryController.getAllCategories:", error.message, error.stack);
      next(error);
    }
  },

  async getCategoryById(req, res, next) {
    const lang = getLanguage(req);
    try {
      // Pass lang to the service
      const category = await categoryService.getCategoryById(req.params.id, lang);
      if (!category) {
        return res.status(404).json({ message: translate('category_not_found', lang) });
      }
      res.status(200).json(category);
    } catch (error) {
      console.error("Error in categoryController.getCategoryById:", error.message, error.stack);
      next(error);
    }
  },

  async updateCategory(req, res, next) {
    const lang = getLanguage(req);
    try {
      const reqDetails = {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        actorUserId: req.user?.id,
      };
      // Pass lang and reqDetails to the service
      const updatedCategory = await categoryService.updateCategory(req.params.id, req.body, lang, reqDetails);
      if (!updatedCategory) {
        return res.status(404).json({ message: translate('category_not_found', lang) });
      }
      res.status(200).json({
        message: translate('category_updated', lang, { name: updatedCategory.mainCategory || updatedCategory.id }),
        data: updatedCategory,
      });
    } catch (error) {
      console.error("Error in categoryController.updateCategory:", error.message, error.stack);
      next(error);
    }
  },

 // --- COMPLETE DELETE LOGIC ---

    async deleteCategory(req, res, next) {
    const lang = getLanguage(req);
        try {
            const reqDetails = {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        actorUserId: req.user?.id,
      };
            const deleted = await categoryService.deleteCategory(req.params.id, lang, reqDetails);
            if (!deleted) {
                return res.status(404).json({ message: lang === 'ar' ? `الفئة الرئيسية غير موجودة.` : `Main category not found.` });
            }
         
            res.status(200).json({ message: lang === 'ar' ? `تم حذف الفئة الرئيسية  وجميع الفئات الفرعية المرتبطة بها.` : `Main category '${deleted.name}' and all associated sub-categories were deleted.` });
        } catch (error) {
            next(error);
        }
    },

    async deleteSubCategory(req, res, next) {
        try {
            const lang = getLanguage(req);
            const reqDetails = {
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                actorUserId: req.user?.id,
            };
            const deleted = await categoryService.deleteSubCategory(req.params.id, lang, reqDetails);
            if (!deleted) {
                return res.status(404).json({ message: lang === 'ar' ? `الفئة الفرعية غير موجودة.` : `Sub-category not found.` });
            }
            res.status(200).json({ message: lang === 'ar' ? `تم حذف الفئة الفرعية.` : `Sub-category '${deleted.name}' was deleted.` });
        } catch (error) {
            next(error);
        }
    },

    async deleteSpecificItem(req, res, next) {
        try {
            const lang = getLanguage(req);
            const reqDetails = {
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
                actorUserId: req.user?.id,
            };
            const deleted = await categoryService.deleteSpecificItem(req.params.id, lang, reqDetails);
            if (!deleted) {
                return res.status(404).json({ message: lang === 'ar' ? `العنصر المحدد غير موجود.` : `Specific item not found.` });
            }
            res.status(200).json({ message: lang === 'ar' ? `تم حذف العنصر المحدد.` : `Specific item '${deleted.name}' was deleted.` });
        } catch (error) {
            next(error);
        }
    },
};



export default categoryController;