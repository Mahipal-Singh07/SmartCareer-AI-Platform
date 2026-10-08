const express = require('express');
const app = express();
const cookieParser = require("cookie-parser")
const cors=require("cors")

/* require all routes here*/ 
const authRouter = require("./routes/auth.routes")

app.use(express.json());
app.use(cookieParser())
app.use(cors({
    origin:"http://localhost:5173",
    credentials:true
}))
/* using all the routes here */
app.use("/api/auth",authRouter)
module.exports = app;
