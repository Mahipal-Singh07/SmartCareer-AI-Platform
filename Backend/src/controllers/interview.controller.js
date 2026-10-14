const pdfParse = require("pdf-parse");

const {
    generateInterviewReport,
    generateResumePdf,
} = require("../services/ai.service");

const interviewReportModel = require("../models/interviewReport.model");

/**
 * Generate an interview report from the uploaded resume,
 * self-description, and job description.
 */
async function generateInterViewReportController(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: "Please upload a resume PDF.",
            });
        }

        const resumeContent = await new pdfParse.PDFParse(
            Uint8Array.from(req.file.buffer)
        ).getText();

        const { selfDescription, jobDescription } = req.body;

        const interviewReportByAi = await generateInterviewReport({
            resume: resumeContent.text,
            selfDescription,
            jobDescription,
        });

        const interviewReport = await interviewReportModel.create({
            user: req.user.id,
            resume: resumeContent.text,
            selfDescription,
            jobDescription,
            ...interviewReportByAi,
            title:
                req.body.title ||
                interviewReportByAi.title ||
                "Backend Developer",
        });

        return res.status(201).json({
            message: "Interview report generated successfully.",
            interviewReport,
        });
    } catch (error) {
        console.error("Interview report generation failed:", error);

        return res.status(500).json({
            message: "Failed to generate interview report.",
            error: error.message,
        });
    }
}

/**
 * Get one interview report belonging to the logged-in user.
 */
async function getInterviewReportByIdController(req, res) {
    try {
        const { interviewId } = req.params;

        const interviewReport = await interviewReportModel.findOne({
            _id: interviewId,
            user: req.user.id,
        });

        if (!interviewReport) {
            return res.status(404).json({
                message: "Interview report not found.",
            });
        }

        return res.status(200).json({
            message: "Interview report fetched successfully.",
            interviewReport,
        });
    } catch (error) {
        console.error("Fetching interview report failed:", error);

        return res.status(500).json({
            message: "Failed to fetch interview report.",
            error: error.message,
        });
    }
}

/**
 * Get all interview reports belonging to the logged-in user.
 */
async function getAllInterviewReportsController(req, res) {
    try {
        const interviewReports = await interviewReportModel
            .find({ user: req.user.id })
            .sort({ createdAt: -1 })
            .select(
                "-resume -selfDescription -jobDescription -__v " +
                "-technicalQuestions -behavioralQuestions " +
                "-skillGaps -preparationPlan"
            );

        return res.status(200).json({
            message: "Interview reports fetched successfully.",
            interviewReports,
        });
    } catch (error) {
        console.error("Fetching interview reports failed:", error);

        return res.status(500).json({
            message: "Failed to fetch interview reports.",
            error: error.message,
        });
    }
}

/**
 * Generate and download a tailored resume PDF.
 */
async function generateResumePdfController(req, res) {
    try {
        const { interviewReportId } = req.params;

        const interviewReport = await interviewReportModel.findOne({
            _id: interviewReportId,
            user: req.user.id,
        });

        if (!interviewReport) {
            return res.status(404).json({
                message: "Interview report not found.",
            });
        }

        const {
            resume,
            jobDescription,
            selfDescription,
        } = interviewReport;

        const pdfBuffer = await generateResumePdf({
            resume,
            jobDescription,
            selfDescription,
        });

        // Confirm that the service returned a non-empty Buffer.
        if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
            console.error("Invalid PDF output:", {
                isBuffer: Buffer.isBuffer(pdfBuffer),
                type: pdfBuffer?.constructor?.name,
                length: pdfBuffer?.length,
            });

            throw new Error(
                "Generated PDF buffer is empty or invalid."
            );
        }

        const pdfHeader = pdfBuffer.subarray(0, 5).toString();

        console.log("PDF buffer size:", pdfBuffer.length, "bytes");
        console.log("PDF header:", pdfHeader);

        if (pdfHeader !== "%PDF-") {
            throw new Error(
                "Generated file does not have a valid PDF header."
            );
        }

        res.status(200);

        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition":
                `attachment; filename="resume_${interviewReportId}.pdf"`,
            "Content-Length": String(pdfBuffer.length),
            "Cache-Control": "no-store",
        });

        return res.end(pdfBuffer);
    } catch (error) {
        console.error("Resume PDF generation failed:", error);

        if (res.headersSent) {
            return res.end();
        }

        return res.status(500).json({
            message: "Failed to generate resume PDF.",
            error: error.message,
        });
    }
}

module.exports = {
    generateInterViewReportController,
    getInterviewReportByIdController,
    getAllInterviewReportsController,
    generateResumePdfController,
};