const { GoogleGenAI, Type } = require("@google/genai");
const Groq = require("groq-sdk");
const puppeteer = require("puppeteer");

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY,
});

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || "missing-groq-api-key",
});

// Primary Gemini models
const MODELS = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
];

const wait = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

function isQuotaError(error) {
    const message = (error?.message || "").toLowerCase();

    return (
        error?.status === 429 ||
        error?.code === 429 ||
        message.includes("429") ||
        message.includes("resource_exhausted") ||
        message.includes("quota exceeded")
    );
}

function isTemporaryError(error) {
    const message = error?.message || "";

    return (
        message.includes("503") ||
        message.includes("UNAVAILABLE") ||
        message.toLowerCase().includes("high demand") ||
        error?.status === 503
    );
}

// Generate content using Groq when Gemini models fail
async function generateWithGroq(prompt, responseSchema) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is missing in .env");
    }

    console.log("Trying Groq backup model...");

    const schemaInstructions = responseSchema
        ? `\nFollow this JSON schema and its nested fields:\n${JSON.stringify(responseSchema)}`
        : "";

    const response = await groq.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: [
            {
                role: "system",
                content: `
Return only one valid JSON object.
Follow the requested fields and nested structure exactly.
Do not wrap the JSON in Markdown.
${schemaInstructions}
                `,
            },
            {
                role: "user",
                content: prompt,
            },
        ],
        response_format: {
            type: "json_object",
        },
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error("Groq returned an empty response");
    }

    // Check that the response is valid JSON
    JSON.parse(content);

    console.log("Groq response generated successfully.");

    // Return the same response shape used by the Gemini SDK
    return { text: content };
}

// Try Gemini models first, then Groq
async function generateWithRetry(request) {
    let lastError;

    for (const model of MODELS) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                console.log(`Trying Gemini model: ${model}`);

                const response = await ai.models.generateContent({
                    ...request,
                    model,
                });

                if (!response?.text) {
                    throw new Error(
                        `${model} returned an empty response`
                    );
                }

                return response;
            } catch (error) {
                lastError = error;

                // Quota errors: skip retries and try the next model
                if (isQuotaError(error)) {
                    console.error(
                        `Quota exhausted for ${model}. Trying next model...`
                    );
                    break;
                }

                // Non-temporary errors: skip retries for this model
                if (!isTemporaryError(error)) {
                    console.error(
                        `Gemini model ${model} failed:`,
                        error.message
                    );
                    break;
                }

                console.error(
                    `${model} temporarily unavailable. Attempt ${attempt + 1}/3`
                );

                if (attempt < 2) {
                    await wait(1000 * 2 ** attempt);
                }
            }
        }
    }

    // All Gemini models failed: try Groq
    try {
        return await generateWithGroq(
            request.contents,
            request.config?.responseSchema
        );
    } catch (groqError) {
        console.error("Groq backup failed:", groqError.message);

        throw new Error(
            `All AI providers failed. Gemini: ${
                lastError?.message || "Unknown error"
            }. Groq: ${groqError.message}`
        );
    }
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
        throw new Error(
            "AI provider returned an empty interview report."
        );
    }

    let report;

    try {
        report = JSON.parse(response.text);
    } catch {
        throw new Error(
            "AI provider returned invalid interview report JSON."
        );
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
        throw new Error(
            "AI provider returned an incomplete interview report."
        );
    }

    if (
        report.technicalQuestions.length === 0 ||
        report.behavioralQuestions.length === 0 ||
        report.preparationPlan.length === 0
    ) {
        throw new Error(
            "AI provider returned empty report sections. Please try again."
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
- Keep the resume concise and professional.
- Focus on relevant information that can improve interview chances.
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
        throw new Error(
            "AI provider returned an empty resume response."
        );
    }

    let resumeData;

    try {
        resumeData = JSON.parse(response.text);
    } catch {
        throw new Error(
            "AI provider returned invalid resume JSON."
        );
    }

    if (
        typeof resumeData.html !== "string" ||
        !resumeData.html.trim()
    ) {
        throw new Error(
            "AI provider did not return valid resume HTML."
        );
    }

    return generatePdfFromHtml(resumeData.html);
}

module.exports = {
    generateInterviewReport,
    generateResumePdf,
};