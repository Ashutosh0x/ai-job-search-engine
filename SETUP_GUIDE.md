# Quick Setup Guide - Resume Optimization

## Prerequisites

1. **Supabase Account**: You need a Supabase project
2. **Google AI Studio Account**: For Gemini API access
3. **Node.js**: Version 16 or higher

## Step 1: Environment Setup

1. Copy the environment template:
   ```bash
   cp env.example .env.local
   ```

2. Fill in your environment variables in `.env.local`:
   ```env
   # Get these from your Supabase project settings
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Get this from Google AI Studio (https://makersuite.google.com/app/apikey)
   GEMINI_API_KEY=your_gemini_api_key
   ```

## Step 2: Database Setup

1. Apply the database migrations:
   ```bash
   # If using Supabase CLI
   supabase db push
   
   # Or manually run the SQL migrations in your Supabase dashboard
   ```

2. The migrations will create:
   - `resumes` table with RLS policies
   - Storage policies for the `resumes` bucket

## Step 3: Storage Setup

1. Create the storage bucket in Supabase dashboard:
   - Go to Storage in your Supabase dashboard
   - Create a new bucket named `resumes`
   - Set it to private (not public)
   - Set file size limit to 10MB
   - Add allowed MIME types: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

2. Or run the setup script:
   ```bash
   npm run setup-storage
   ```

## Step 4: Install Dependencies

```bash
npm install
```

## Step 5: Start Development Server

```bash
npm run dev
```

## Step 6: Test the Feature

1. Navigate to `http://localhost:3000/resume`
2. Upload a PDF or DOCX resume
3. Wait for parsing to complete
4. Click "Optimize Resume" to run AI analysis
5. View detailed results and recommendations

## Troubleshooting

### Common Issues

1. **"Missing Supabase environment variables"**
   - Check your `.env.local` file
   - Ensure all Supabase keys are correct

2. **"Gemini API key not found"**
   - Get your API key from https://makersuite.google.com/app/apikey
   - Add it to `.env.local`

3. **"Storage bucket not found"**
   - Create the `resumes` bucket in Supabase dashboard
   - Or run `npm run setup-storage`

4. **"Database table not found"**
   - Run the migrations: `supabase db push`
   - Or manually create the `resumes` table

### Getting API Keys

1. **Supabase Keys**:
   - Go to your Supabase project dashboard
   - Navigate to Settings > API
   - Copy the URL and keys

2. **Gemini API Key**:
   - Go to https://makersuite.google.com/app/apikey
   - Create a new API key
   - Copy the key to your `.env.local`

## Features Available

✅ **Resume Upload**: PDF, DOC, DOCX support  
✅ **Text Extraction**: Automatic parsing of resume content  
✅ **AI Analysis**: Gemini-powered ATS scoring  
✅ **Detailed Insights**: Section-by-section analysis  
✅ **Visual Charts**: Interactive data visualization  
✅ **Export Options**: PDF export of results  
✅ **Security**: RLS-protected storage and database  

## Next Steps

1. **Customize Analysis**: Modify the AI prompts in `/app/api/analyze-resume/route.ts`
2. **Add Job Matching**: Integrate with your jobs database
3. **Enhance UI**: Add more visualizations and interactions
4. **Scale**: Consider edge functions for heavy processing

## Support

- Check the full documentation in `RESUME_OPTIMIZATION.md`
- Review the API endpoints in `/app/api/`
- Examine the database schema in `/supabase/migrations/` 