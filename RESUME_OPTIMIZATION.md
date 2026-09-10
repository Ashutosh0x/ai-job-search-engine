# Resume Optimization Feature

This document outlines the complete resume optimization system that allows users to upload resumes, analyze them using AI, and receive detailed ATS compatibility scores and recommendations.

## Features

### 1. Resume Upload & Storage
- **Supported Formats**: PDF, DOC, DOCX
- **File Size Limit**: 10MB
- **Storage**: Supabase Storage with RLS (Row Level Security)
- **User Isolation**: Each user can only access their own resumes

### 2. AI-Powered Analysis
- **AI Engine**: Google Gemini Pro
- **Analysis Components**:
  - ATS Compatibility Score (0-100)
  - Section-by-section analysis
  - Keyword optimization
  - Formatting assessment
  - Detailed recommendations

### 3. Detailed Insights
- **Visual Charts**: Bar charts for section scores, pie charts for keyword analysis
- **Interactive Tabs**: Overview, Sections, Keywords, Recommendations
- **Export Options**: PDF export of analysis results
- **Real-time Updates**: Live status updates during processing

## Architecture

### Database Schema

```sql
-- Resumes table
CREATE TABLE resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  file_type text,
  parsed_text text,
  parsed_info jsonb,
  ats_score integer,
  ats_analysis jsonb,
  insights jsonb,
  status text DEFAULT 'uploaded',
  source text DEFAULT 'upload',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);
```

### API Endpoints

1. **POST /api/parse-resume**
   - Extracts text from uploaded files
   - Parses contact information, skills, experience
   - Stores parsed data in database

2. **POST /api/analyze-resume**
   - Uses Gemini AI for comprehensive analysis
   - Generates ATS scores and recommendations
   - Updates resume record with analysis results

### Storage Structure

```
resumes/
├── {user_id}/
│   ├── {timestamp}-{filename}.pdf
│   ├── {timestamp}-{filename}.docx
│   └── ...
```

## Setup Instructions

### 1. Environment Variables

Create a `.env.local` file with the following variables:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 2. Database Setup

Run the Supabase migrations:

```bash
# Apply migrations
supabase db push

# Or run individual migrations
supabase migration up
```

### 3. Storage Setup

Create the storage bucket and policies:

```bash
# Run the storage setup script
npm run setup-storage

# Or manually create the bucket in Supabase dashboard
# Bucket name: resumes
# Public: false
# File size limit: 10MB
# Allowed MIME types: application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

### 4. Install Dependencies

```bash
npm install
```

## Usage Flow

### 1. User Uploads Resume
- User drags and drops or selects a resume file
- File is validated (type, size)
- File is uploaded to Supabase Storage
- Status: `uploaded`

### 2. Resume Parsing
- Text is extracted from the document
- Contact information, skills, and experience are parsed
- Parsed data is stored in database
- Status: `parsed`

### 3. AI Analysis
- Parsed text is sent to Gemini AI
- AI analyzes ATS compatibility
- Generates detailed scores and recommendations
- Results are stored in database
- Status: `analyzed`

### 4. Results Display
- User sees comprehensive analysis dashboard
- Interactive charts and visualizations
- Detailed recommendations for improvement
- Option to export results as PDF

## Security Features

### Row Level Security (RLS)
- Users can only access their own resumes
- Storage objects are protected by user-specific policies
- Database records are isolated by user_id

### File Validation
- File type validation (PDF, DOC, DOCX only)
- File size limits (10MB max)
- MIME type checking

### API Security
- Authentication required for all operations
- Input validation and sanitization
- Error handling with user-friendly messages

## AI Analysis Components

### ATS Score Calculation
The AI evaluates resumes based on:

1. **Contact Information** (25%)
   - Complete contact details
   - Professional email format
   - Location information

2. **Professional Experience** (30%)
   - Quantified achievements
   - Action verbs usage
   - Relevant experience

3. **Skills & Keywords** (25%)
   - Industry-specific keywords
   - Technical skills
   - Soft skills

4. **Education & Certifications** (15%)
   - Relevant degree
   - Certifications
   - Academic performance

5. **Formatting & Structure** (5%)
   - Clean formatting
   - Professional layout
   - ATS-friendly structure

### Keyword Analysis
- **Found Keywords**: Skills and terms detected in resume
- **Missing Keywords**: Recommended skills for target roles
- **Suggestions**: Specific recommendations for improvement

## Error Handling

### Upload Errors
- File type not supported
- File size exceeds limit
- Network connectivity issues
- Storage quota exceeded

### Parsing Errors
- Corrupted file
- Unsupported file format
- Text extraction failed

### Analysis Errors
- AI service unavailable
- Invalid response format
- Rate limiting

### User Feedback
- Clear error messages
- Retry options
- Progress indicators
- Status updates

## Performance Optimizations

### File Processing
- Asynchronous processing
- Progress indicators
- Background processing for large files

### AI Analysis
- Caching of analysis results
- Batch processing capabilities
- Rate limiting protection

### Database
- Indexed queries for faster retrieval
- Efficient storage of JSON data
- Optimized user-specific queries

## Future Enhancements

### Planned Features
1. **Job Matching**: Match resume to specific job postings
2. **Resume Templates**: Pre-built templates for different industries
3. **Collaborative Editing**: Share resumes with mentors/recruiters
4. **Version History**: Track changes and improvements over time
5. **Industry-Specific Analysis**: Tailored recommendations by industry

### Advanced AI Features
1. **Semantic Analysis**: Understand context and meaning
2. **Skill Gap Analysis**: Identify missing skills for target roles
3. **Salary Optimization**: Optimize resume for salary negotiations
4. **Cultural Fit**: Analyze alignment with company culture

### Integration Opportunities
1. **Job Boards**: Direct application with optimized resume
2. **LinkedIn Integration**: Sync with LinkedIn profile
3. **ATS Integration**: Direct submission to ATS systems
4. **Career Coaching**: Integration with career coaching services

## Troubleshooting

### Common Issues

1. **File Upload Fails**
   - Check file size and type
   - Verify network connection
   - Ensure user is authenticated

2. **Analysis Takes Too Long**
   - Check AI service status
   - Verify API key is valid
   - Monitor rate limits

3. **Results Not Displaying**
   - Check browser console for errors
   - Verify database connection
   - Ensure proper authentication

### Debug Mode
Enable debug logging by setting:
```env
NODE_ENV=development
DEBUG=resume-optimization:*
```

## Support

For technical support or feature requests, please contact the development team or create an issue in the project repository. 