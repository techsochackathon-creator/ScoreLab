import { EventSchemas, Inngest } from "inngest";

type EvaluationRequested = {
  data: {
    jobId: string;
    submissionId: string;
    trigger: "submit" | "manual";
  };
};

type Events = {
  "evaluation/requested": EvaluationRequested;
};

export const inngest = new Inngest({
  id: "hackathon-eval",
  schemas: new EventSchemas().fromRecord<Events>(),
});
