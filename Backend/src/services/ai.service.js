
const { GoogleGenAI, Type } = require("@google/genai");
const { z } = require("zod");

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY,
});

// Zod schema for validating Gemini's response
const interviewReportSchema = z.object({
    matchScore: z.number().min(0).max(100),

    technicalQuestions: z.array(
        z.object({
            question: z.string(),
            intention: z.string(),
            answer: z.string(),
        })
    ),

    behavioralQuestions: z.array(
        z.object({
            question: z.string(),
            intention: z.string(),
            answer: z.string(),
        })
    ),

    skillGaps: z.array(
        z.object({
            skill: z.string(),
            severity: z.enum(["low", "medium", "high"]),
        })
    ),

    preparationPlan: z.array(
        z.object({
            day: z.number(),
            focus: z.string(),
            tasks: z.array(z.string()),
        })
    ),

    title: z.string(),
});

// Gemini's native structured-output schema
const responseSchema = {
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

async function generateInterviewReport({
    resume,
    selfDescription,
    jobDescription,
}) {
    const prompt = `
Generate an interview preparation report using the information below.

JOB DESCRIPTION:
${jobDescription || "Not provided"}

RESUME:
${resume || "Not provided"}

CANDIDATE SELF-DESCRIPTION:
${selfDescription || "Not provided"}

Requirements:
1. Extract the actual job title from the job description.
2. Calculate matchScore between 0 and 100.
3. Generate exactly 10 technical questions.
4. Generate exactly 5 behavioral questions.
5. Generate 3 to 5 skill gaps.
6. Generate a preparation plan covering days 1 through 7.
7. Every technical and behavioral question must contain:
   question, intention, and answer.
8. Every skill gap must contain skill and severity.
9. Severity must be low, medium, or high.
10. Every preparation-plan item must contain day, focus, and tasks.
11. Make the answers useful for interview preparation.
12. Use the candidate's actual experience and the job requirements.
13. Do not return null values or omit required fields.
`;

    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema,
        },
    });

    if (!response.text) {
        throw new Error("Gemini returned an empty response.");
    }

    // console.log("Gemini response:", response.text);

    const parsedData = JSON.parse(response.text);

    const result = interviewReportSchema.parse(parsedData);

    return result;
}

module.exports = { generateInterviewReport };
