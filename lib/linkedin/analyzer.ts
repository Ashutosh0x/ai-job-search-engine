import { GoogleGenerativeAI } from '@google/generative-ai';
import { LinkedInProfile, ProfileAnalysis } from './types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function analyzeProfile(profile: LinkedInProfile): Promise<ProfileAnalysis> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Years of experience, from the earliest year actually present in the
    // profile. Null when no date parses: the old code fell back to
    // `roles × 2`, which fed the model a number nobody had stated and came
    // back as a salary band built on it.
    let totalYears: number | null = null;
    if (profile.experience && profile.experience.length > 0) {
      const currentYear = new Date().getFullYear();
      let earliestYear = currentYear;
      for (const exp of profile.experience) {
        const match = exp.dateRange?.match(/\d{4}/g);
        if (match) {
          earliestYear = Math.min(earliestYear, ...match.map(Number));
        }
      }
      if (earliestYear < currentYear) {
        totalYears = currentYear - earliestYear;
      }
    }

    const prompt = `
Analyze this LinkedIn profile and return a JSON object with the following structure:
{
  "overallScore": <number 0-100>,
  "strengths": [<3-5 strings>],
  "improvements": [<3-5 strings>],
  "salaryEstimate": { "min": <number>, "max": <number>, "currency": "<string, e.g. USD>", "confidence": "<Low/Medium/High>" },
  "careerTrajectory": { "currentLevel": "<string>", "nextRole": "<string>", "timeframe": "<string>", "skills_to_develop": [<strings>] },
  "recruiterInsights": {
    "hiringLikelihood": "<string>",
    "idealRoles": [<strings>],
    "redFlags": [<strings>],
    "standoutFactors": [<strings>]
  },
  "jobFitSummary": "<string paragraph>",
  "industryBenchmark": "<string paragraph>"
}

Profile Details:
Name: ${profile.name}
Headline: ${profile.headline}
Location: ${profile.location}
About: ${profile.about}
Approximate Years of Experience: ${totalYears === null ? 'unknown — no dates on this profile, do not assume a figure' : totalYears}

Experience:
${profile.experience.map(e => `- ${e.title} at ${e.company} (${e.dateRange})\n  ${e.description || ''}`).join('\n')}

Education:
${profile.education.map(e => `- ${e.degree} in ${e.fieldOfStudy} from ${e.school}`).join('\n')}

Skills: ${profile.skills.map(s => s.name).join(', ')}

Respond ONLY with valid JSON.
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Extract JSON if it is wrapped in markdown blocks
    const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    const jsonString = jsonMatch ? jsonMatch[1] : responseText;
    
    return JSON.parse(jsonString) as ProfileAnalysis;
  } catch (error) {
    console.error('Error analyzing LinkedIn profile with Gemini:', error);

    // Deliberately no fallback analysis.
    //
    // This used to return a filled-in object — overallScore 50, a 0-to-0
    // salary band, "Unknown" trajectory — which the panel renders exactly like
    // a real result. A reader sees a score out of 100 and has no way to tell
    // that nothing was analysed. The route turns this into a 500 and the page
    // shows its error state with a retry.
    throw new Error(
      error instanceof Error
        ? `Profile analysis failed: ${error.message}`
        : 'Profile analysis failed'
    );
  }
}
