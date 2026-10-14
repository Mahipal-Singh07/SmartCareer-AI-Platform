const { GoogleGenAI, Type } = require("@google/genai");
const Groq = require("groq-sdk");
const puppeteer = require("puppeteer");

const ai = process.env.GOOGLE_GENAI_API_KEY
    ? new GoogleGenAI({
          apiKey: process.env.GOOGLE_GENAI_API_KEY,
      })
    : null;

const groq = process.env.GROQ_API_KEY
    ? new Groq({
          apiKey: process.env.GROQ_API_KEY,
      })
    : null;

const MODELS = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
];

const wait = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

function errorMessage(error) {
    return String(error?.message || error || "Unknown error");
}

function isQuotaError(error) {
    const message = errorMessage(error).toLowerCase();

    return (
        error?.status === 429 ||
        error?.code === 429 ||
        message.includes("429") ||
        message.includes("resource_exhausted") ||
        message.includes("quota exceeded") ||
        message.includes("rate limit")
    );
}

function isTemporaryError(error) {
    const message = errorMessage(error).toLowerCase();

    return (
        [408, 500, 502, 503, 504].includes(Number(error?.status)) ||
        [408, 500, 502, 503, 504].includes(Number(error?.code)) ||
        /\b(408|500|502|503|504)\b/.test(message) ||
        message.includes("unavailable") ||
        message.includes("high demand") ||
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("internal error")
    );
}

function isModelOrRequestError(error) {
    const message = errorMessage(error).toLowerCase();

    return (
        [400, 404].includes(Number(error?.status)) ||
        [400, 404].includes(Number(error?.code)) ||
        message.includes("not found") ||
        message.includes("unsupported model") ||
        message.includes("invalid argument") ||
        message.includes("invalid model")
    );
}

// Convert Gemini prompt contents to text for Groq.
function getPromptText(contents) {
    if (typeof contents === "string") {
        return contents;
    }

    if (Array.isArray(contents)) {
        return contents
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (typeof item?.text === "string") {
                    return item.text;
                }

                if (Array.isArray(item?.parts)) {
                    return item.parts
                        .map((part) => part?.text || "")
                        .join("\n");
                }

                return "";
            })
            .filter(Boolean)
            .join("\n");
    }

    return String(contents ?? "");
}

function schemaInstructions(schema) {
    if (!schema) {
        return "";
    }

    return `
Follow this JSON schema, including its required fields
and nested structures:

${JSON.stringify(schema)}
`;
}

// Generate JSON with Groq.
async function generateWithGroq(prompt, responseSchema) {
    if (!groq) {
        throw new Error("GROQ_API_KEY is missing in .env");
    }

    console.time("Groq request");

    try {
        const response = await groq.chat.completions.create({
            model: "openai/gpt-oss-20b",

            messages: [
                {
                    role: "system",
                    content: `
Return exactly one valid JSON object.
Do not return Markdown or explanations.
Follow all requested fields, data types, and nested structures.

${schemaInstructions(responseSchema)}
                    `.trim(),
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],

            response_format: {
                type: "json_object",
            },

            max_tokens: 6000,
        });

        const content =
            response.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error("Groq returned an empty response");
        }

        JSON.parse(content);

        console.log("Groq response generated successfully.");

        return {
            text: content,
        };
    } finally {
        console.timeEnd("Groq request");
    }
}

// Interview reports: Groq first, Gemini fallback.
async function generateWithRetry(request) {
    let lastError;

    const prompt = getPromptText(request.contents);
    const config = request.config || {};

    try {
        console.log("Trying Groq as primary AI provider...");
        console.time("Groq primary");

        try {
            const response = await generateWithGroq(
                prompt,
                config.responseSchema
            );

            console.log("Groq generated the response successfully.");

            return response;
        } finally {
            console.timeEnd("Groq primary");
        }
    } catch (error) {
        lastError = error;

        console.error("Groq failed:", error.message);
        console.log("Switching to Gemini...");
    }

    if (ai) {
        for (const model of MODELS) {
            const timer = `Gemini fallback: ${model}`;

            console.log(`Trying Gemini fallback: ${model}`);
            console.time(timer);

            try {
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

                console.error(
                    `Gemini fallback failed (${model}):`,
                    error.message
                );
            } finally {
                console.timeEnd(timer);
            }
        }
    }

    throw new Error(
        `All AI providers failed. ${
            lastError?.message || "Unknown error"
        }`
    );
}

// Resume PDFs: Gemini first, Groq fallback.
// This function is defined outside generateWithRetry().
async function generateResumeWithGeminiFirst(request) {
    let lastError;

    if (ai) {
        for (const model of MODELS) {
            const timer = `Resume Gemini: ${model}`;

            console.log(`Resume: trying Gemini ${model}`);
            console.time(timer);

            try {
                const response = await ai.models.generateContent({
                    ...request,
                    model,
                });

                if (!response?.text) {
                    throw new Error(
                        "Gemini returned an empty response"
                    );
                }

                console.log(
                    "Resume content generated using Gemini."
                );

                return response;
            } catch (error) {
                lastError = error;

                console.error(
                    `Resume Gemini failed (${model}):`,
                    error.message
                );

                // Don't retry the same model for quota or invalid-request errors.
                if (
                    isQuotaError(error) ||
                    isModelOrRequestError(error)
                ) {
                    break;
                }

                // Continue to the next model for other failures.
            } finally {
                console.timeEnd(timer);
            }
        }
    } else {
        lastError = new Error(
            "GOOGLE_GENAI_API_KEY is missing in .env"
        );
    }

    // Use Groq if Gemini fails.
    try {
        console.log("Resume: falling back to Groq");

        return await generateWithGroq(
            getPromptText(request.contents),
            request.config?.responseSchema
        );
    } catch (error) {
        throw new Error(
            `Resume generation failed. Gemini: ${
                lastError?.message || "Unavailable"
            }. Groq: ${error.message}`
        );
    }
}

// Interview report response schema.
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
                    question: {
                        type: Type.STRING,
                    },

                    intention: {
                        type: Type.STRING,
                    },

                    answer: {
                        type: Type.STRING,
                    },
                },

                required: [
                    "question",
                    "intention",
                    "answer",
                ],
            },
        },

        behavioralQuestions: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,

                properties: {
                    question: {
                        type: Type.STRING,
                    },

                    intention: {
                        type: Type.STRING,
                    },

                    answer: {
                        type: Type.STRING,
                    },
                },

                required: [
                    "question",
                    "intention",
                    "answer",
                ],
            },
        },

        skillGaps: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,

                properties: {
                    skill: {
                        type: Type.STRING,
                    },

                    severity: {
                        type: Type.STRING,
                        enum: ["low", "medium", "high"],
                    },
                },

                required: [
                    "skill",
                    "severity",
                ],
            },
        },

        preparationPlan: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,

                properties: {
                    day: {
                        type: Type.NUMBER,
                    },

                    focus: {
                        type: Type.STRING,
                    },

                    tasks: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.STRING,
                        },
                    },
                },

                required: [
                    "day",
                    "focus",
                    "tasks",
                ],
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

// Parse JSON returned by either provider.
function parseJsonResponse(text, message) {
    if (typeof text !== "string" || !text.trim()) {
        throw new Error(message);
    }

    try {
        return JSON.parse(text);
    } catch {
        throw new Error(message);
    }
}

// Generate an interview report.
async function generateInterviewReport({
    resume,
    selfDescription,
    jobDescription,
}) {
    const prompt = `
You are an expert technical interviewer and career advisor.

Generate a detailed, personalized interview preparation report.

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
6. Identify the 3 to 5 skill gaps with severity low, medium, or high.
7. Generate a 7-day preparation plan.
8. Every preparation day must contain numeric day, focus, and tasks.
9. Tailor the output to the supplied resume and job description.
10. Return objects in arrays, not plain strings.
11. Populate all sections with meaningful information.
12. Do not invent candidate qualifications or experience.
13. Return only JSON matching the supplied schema.
`;

    const response = await generateWithRetry({
        contents: prompt,

        config: {
            responseMimeType: "application/json",
            responseSchema: interviewReportSchema,
        },
    });

    const report = parseJsonResponse(
        response.text,
        "AI provider returned invalid or empty interview report JSON."
    );

    const requiredArrays = [
        "technicalQuestions",
        "behavioralQuestions",
        "skillGaps",
        "preparationPlan",
    ];

    if (
        !report.title ||
        typeof report.matchScore !== "number" ||
        !Number.isFinite(report.matchScore) ||
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
        report.skillGaps.length === 0 ||
        report.preparationPlan.length === 0
    ) {
        throw new Error(
            "AI provider returned empty report sections. Please try again."
        );
    }

    console.log("Interview report generated successfully.");

    return report;
}

// Convert HTML into a PDF Buffer.
async function generatePdfFromHtml(htmlContent) {
    if (
        typeof htmlContent !== "string" ||
        !htmlContent.trim()
    ) {
        throw new Error(
            "Cannot generate PDF: HTML content is empty."
        );
    }

    console.time("PDF generation");

    const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

    try {
        const page = await browser.newPage();

        page.setDefaultNavigationTimeout(15000);
        page.setDefaultTimeout(15000);

        await page.setContent(htmlContent, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
        });

        await page.emulateMediaType("print");

        // Avoid waiting indefinitely for fonts.
        await Promise.race([
            page.evaluate(() => document.fonts?.ready),
            wait(1500),
        ]);

        const pdfBytes = await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,

            margin: {
                top: "20mm",
                bottom: "20mm",
                left: "15mm",
                right: "15mm",
            },
        });

        // IMPORTANT: Return a Node.js Buffer.
        const pdfBuffer = Buffer.from(pdfBytes);

        console.log(
            "Generated PDF size:",
            pdfBuffer.length,
            "bytes"
        );

        console.log(
            "Generated PDF header:",
            pdfBuffer.subarray(0, 5).toString()
        );

        if (
            pdfBuffer.length === 0 ||
            pdfBuffer.subarray(0, 5).toString() !== "%PDF-"
        ) {
            throw new Error(
                "Puppeteer did not generate a valid PDF."
            );
        }

        return pdfBuffer;
    } finally {
        await browser.close();
        console.timeEnd("PDF generation");
    }
}

// Generate a tailored resume PDF.
async function generateResumePdf({
    resume,
    selfDescription,
    jobDescription,
}) {
    const prompt = `
Create a professional, ATS-friendly resume tailored to the job.

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
- Return only valid JSON with the html field.
`;

    const response = await generateResumeWithGeminiFirst({
        contents: prompt,

        config: {
            responseMimeType: "application/json",

            responseSchema: {
                type: Type.OBJECT,

                properties: {
                    html: {
                        type: Type.STRING,
                    },
                },

                required: ["html"],
            },
        },
    });

    const resumeData = parseJsonResponse(
        response.text,
        "AI provider returned invalid or empty resume JSON."
    );

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