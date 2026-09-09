import { createContext, useContext } from "react";

export const TranscriptPreferences = createContext({ showThinking: false });
export const useTranscriptPreferences = () => useContext(TranscriptPreferences);
