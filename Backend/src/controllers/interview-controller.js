const pdfParse = require("pdf-parse")
const generateInterviewReport=require("../services/ai.service")
const interviewReportModel = require("../models/interviewReport.model")

async function generateInterviewReportController(req,res){


const resumeContent = pdfParse(req.file.buffer)
const {selfDescription,jobDescription} = req.body

const interviewReportByAi = await generateInterviewReport({
    resume:resumeContent,
    
    selfDescription,
    jobDescription
})

const interviewReport = await interviewReportModel.create({
    user:req.user.id,
    resume:resumeContent,
    selfDescription,
    jobDescription,
    ...interviewReportByAi
})

res.status(201).json({
    messages:"Interview report generated succesfully",
    interviewReport
})
}


module.exports = {generateInterviewReportController}

