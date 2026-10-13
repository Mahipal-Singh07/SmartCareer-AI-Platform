
const { GoogleGenAI, Type } = require("@google/genai");
const puppeteer = require("puppeteer");

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY,
});

// Primary model and fallback model
const MODELS = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
];

const wait = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

function isTemporaryError(error) {
    const message = error?.message || "";

    return (
        message.includes("503") ||
        message.includes("UNAVAILABLE") ||
        message.toLowerCase().includes("high demand") ||
        error?.status === 503
    );
}

// Retry temporarily unavailable models and try the fallback model.
async function generateWithRetry(request) {
    let lastError;

    for (const model of MODELS) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                console.log(`Trying Gemini model: ${model}`);

                return await ai.models.generateContent({
                    ...request,
                    model,
                });
            } catch (error) {
                lastError = error;

                if (!isTemporaryError(error)) {
                    throw error;
                }

                console.error(
                    `${model} unavailable. Attempt ${attempt + 1}/3`
                );

                if (attempt < 2) {
                    await wait(1000 * 2 ** attempt);
                }
            }
        }
    }

    throw lastError;
}

// Interview report response schema
const interviewReportSchema = {
    type: Type.OBJECT,
    properties: {
        title: {
            type: Type.STRING,
        },
        matchScore: {
            type: Type.NUMBER,
        },
        technicalQuestions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    question: { type: Type.STRING },
                    intention: { type: Type.STRING },
                    answer: { type: Type.STRING },
                },
                required: ["question", "intention", "answer"],
            },
        },
        behavioralQuestions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    question: { type: Type.STRING },
                    intention: { type: Type.STRING },
                    answer: { type: Type.STRING },
                },
                required: ["question", "intention", "answer"],
            },
        },
        skillGaps: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    skill: { type: Type.STRING },
                    severity: {
                        type: Type.STRING,
                        enum: ["low", "medium", "high"],
                    },
                },
                required: ["skill", "severity"],
            },
        },
        preparationPlan: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    day: { type: Type.NUMBER },
                    focus: { type: Type.STRING },
                    tasks: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                    },
                },
                required: ["day", "focus", "tasks"],
            },
        },
    },
    required: [
        "title",
        "matchScore",
        "technicalQuestions",
        "behavioralQuestions",
        "skillGaps",
        "preparationPlan",
    ],
};

// Generate interview report
async function generateInterviewReport({
    resume,
    selfDescription,
    jobDescription,
}) {
    const prompt = `
You are an expert technical interviewer and career advisor.

Generate a detailed interview preparation report.

RESUME:
${resume}

SELF-DESCRIPTION:
${selfDescription}

JOB DESCRIPTION:
${jobDescription}

Instructions:
1. Extract the job title from the job description.
2. Give a realistic match score between 0 and 100.
3. Generate 8 to 10 technical interview questions.
4. Generate 5 behavioral interview questions.
5. Every question must contain question, intention, and answer.
6. Identify 3 to 5 skill gaps with severity low, medium, or high.
7. Generate a 7-day preparation plan.
8. Every preparation day must contain numeric day, focus, and tasks.
9. Tailor the output to the supplied resume and job description.
10. Return objects in arrays, not plain strings.
11. Populate all sections with meaningful information.
12. Do not invent candidate qualifications or experience.
`;

    const response = await generateWithRetry({
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: interviewReportSchema,
        },
    });

    if (!response.text) {
        throw new Error("Gemini returned an empty interview report.");
    }

    let report;

    try {
        report = JSON.parse(response.text);
    } catch {
        throw new Error("Gemini returned invalid JSON.");
    }

    const requiredArrays = [
        "technicalQuestions",
        "behavioralQuestions",
        "skillGaps",
        "preparationPlan",
    ];

    if (
        !report.title ||
        typeof report.matchScore !== "number" ||
        report.matchScore < 0 ||
        report.matchScore > 100 ||
        requiredArrays.some(
            (field) => !Array.isArray(report[field])
        )
    ) {
        throw new Error("Gemini returned an incomplete interview report.");
    }

    if (
        report.technicalQuestions.length === 0 ||
        report.behavioralQuestions.length === 0 ||
        report.preparationPlan.length === 0
    ) {
        throw new Error(
            "Gemini returned empty report sections. Please try again."
        );
    }

    console.log("Interview report generated successfully.");

    return report;
}

// Convert HTML into a PDF
async function generatePdfFromHtml(htmlContent) {
    const browser = await puppeteer.launch();

    try {
        const page = await browser.newPage();

        await page.setContent(htmlContent, {
            waitUntil: "networkidle0",
        });

        return await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "20mm",
                bottom: "20mm",
                left: "15mm",
                right: "15mm",
            },
        });
    } finally {
        await browser.close();
    }
}

// Generate resume PDF
async function generateResumePdf({
    resume,
    selfDescription,
    jobDescription,
}) {
    const prompt = `
Create a professional ATS-friendly resume tailored to the job.

RESUME:
${resume}

SELF-DESCRIPTION:
${selfDescription}

JOB DESCRIPTION:
${jobDescription}

Return a JSON object with one field named "html".
The html field must contain a complete HTML resume.

Requirements:
- Use the candidate's actual information.
- Do not invent experience or qualifications.
- Highlight skills relevant to the job.
- Use a simple professional layout.
- Make the resume suitable for an A4 PDF.
-Give the resume of one page only and that looks real to human written and not by the ai.
-The resume should not be so lengthy, it should ideally be 1-2 pages long when converted to PDF. Focus on quality rather than quantity and make sure to include all the relevant information that can increase the candidate's chances of getting an interview call for the given job description
`;

    const response = await generateWithRetry({
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    html: { type: Type.STRING },
                },
                required: ["html"],
            },
        },
    });

    if (!response.text) {
        throw new Error("Gemini returned an empty resume response.");
    }

    let resumeData;

    try {
        resumeData = JSON.parse(response.text);
    } catch {
        throw new Error("Gemini returned invalid resume JSON.");
    }

    if (
        typeof resumeData.html !== "string" ||
        !resumeData.html.trim()
    ) {
        throw new Error("Gemini did not return valid resume HTML.");
    }

    return generatePdfFromHtml(resumeData.html);
}

module.exports = {
    generateInterviewReport,
    generateResumePdf,
};
