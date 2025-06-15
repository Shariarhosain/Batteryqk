import jwt from 'jsonwebtoken';


const generateToken = (uid) => {
  return jwt.sign({ uid }, process.env.SECRET_CODE, {
    expiresIn: '1d', // Token expires in 1 day
  });
};

export { generateToken };