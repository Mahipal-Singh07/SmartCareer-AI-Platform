import { useState } from "react";
import {
  generateInterviewReport,
  getInterviewReportById,
  getAllInterviewReports,
  generateResumePdf,
} from "../services/interview.api";

export const useInterview = () => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");

  const generateReport = async (formData) => {
    setLoading(true);
    setError("");

    try {
      const response = await generateInterviewReport(formData);

      if (!response?.interviewReport) {
        throw new Error("Failed to generate interview report");
      }

      setReport(response.interviewReport);
      return response.interviewReport;
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to generate interview report"
      );
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getReportById = async (id) => {
    setLoading(true);
    setError("");

    try {
      const response = await getInterviewReportById(id);

      if (!response?.interviewReport) {
        throw new Error("Interview report not found");
      }

      setReport(response.interviewReport);
      return response.interviewReport;
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to fetch interview report"
      );
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getReports = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await getAllInterviewReports();

      if (!response || !Array.isArray(response.reports)) {
        throw new Error("Failed to fetch interview reports");
      }

      setReports(response.reports);
      return response.reports;
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Failed to fetch interview reports"
      );
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const getResumePdf = async (interviewReportId) => {
  setLoading(true);
  setError("");

  try {
    const pdfBlob = await generateResumePdf({ interviewReportId });

    const url = window.URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `resume_${interviewReportId}.pdf`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 1000);
  } catch (err) {
    setError("Failed to download resume PDF.");
    throw err;
  } finally {
    setLoading(false);
  }
};

  return {
    loading,
    report,
    reports,
    error,
    generateReport,
    getReportById,
    getReports,
    getResumePdf,
  };
};