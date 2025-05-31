import jwt from 'jsonwebtoken';
import prisma from '../utils/prismaClient.js';
import { translate, getLanguage } from '../utils/i18n.js';

const verifyToken = async (req, res, next) => {
  const lang = getLanguage(req);
  console.log("Token verification middleware called", lang); // Debugging log
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: translate('unauthorized_no_token', lang) });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.SECRET_CODE);
    const user = await prisma.user.findUnique({ where: { uid: decoded.uid } });

    if (!user) {
      return res.status(401).json({ message: translate('unauthorized_invalid_user', lang) });
    }

    req.user = user; // Attach user object to request (contains id, uid, email etc.)
    req.userUid = user.uid; // For convenience
    next();
  } catch (error) {
    console.error("Token verification error:", error.message);
    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: translate('unauthorized_token_expired', lang) });
    }
    return res.status(401).json({ message: translate('unauthorized_invalid_token', lang) });
  }
};
// Add to en.json / ar.json
// "unauthorized_no_token": "Unauthorized. No token provided.",
// "unauthorized_invalid_user": "Unauthorized. User not found.",
// "unauthorized_token_expired": "Unauthorized. Token has expired.",
// "unauthorized_invalid_token": "Unauthorized. Invalid token."

export default verifyToken;