const {Router} = require('express')
const authController=require("../controllers/auth.controllers.js")

const authRouter=Router()

/**
 * @route POST /api/auth/register
 * @description register a new user
 * @access Public
 */
authRouter.post("/register", authController.registerUserController)

/**
 * @route POST /api/auth/login
 * @description login user with email and password
 * @access Public
 */

authRouter.post("/login",authController.loginUserController)


/**
 * @route GET /api/auth/logout
 * @description clear token from user cookie and token in the blacklist
 * @access Public
 */

authRouter.get("/logout",authController.logoutUserController)
module.exports = authRouter