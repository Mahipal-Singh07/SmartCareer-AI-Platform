const express = require('express');
const app = express();
const cookieParser = require("cookie-parser")

/* require all routes here*/ 
const authRouter = require("./routes/auth.routes")

app.use(express.json());
app.use(cookieParser())
/* using all the routes here */
app.use("/api/auth",authRouter)
module.exports = app;
