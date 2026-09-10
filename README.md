# JobSpark AI Documentation

This repository contains the comprehensive documentation for JobSpark AI, an AI-powered job search platform built with Next.js, React, and Supabase.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Mintlify CLI (for local development)

### Installation

1. **Install Mintlify CLI**
   ```bash
   npm install -g mintlify
   ```

2. **Start Local Development**
   ```bash
   mintlify dev
   ```

3. **View Documentation**
   Open [http://localhost:3000/docs](http://localhost:3000/docs) in your browser

## 📁 Documentation Structure

```
docs/
├── mint.json                 # Mintlify configuration
├── introduction.mdx          # Main introduction page
├── quickstart.mdx           # Quick start guide
├── features/                # Feature documentation
│   ├── ai-resume-analysis.mdx
│   ├── job-matching.mdx
│   ├── resume-builder.mdx
│   ├── profile-management.mdx
│   ├── job-tracking.mdx
│   └── analytics-dashboard.mdx
├── user-management/         # User management docs
│   ├── profile-settings.mdx
│   ├── preferences.mdx
│   ├── security.mdx
│   └── localization.mdx
├── api/                     # API documentation
│   ├── authentication.mdx
│   ├── resume-analysis.mdx
│   ├── job-matching.mdx
│   ├── profile-management.mdx
│   └── upload-endpoints.mdx
├── guides/                  # User guides
│   ├── resume-optimization.mdx
│   ├── job-search-strategy.mdx
│   ├── profile-completion.mdx
│   └── security-best-practices.mdx
├── pricing/                 # Pricing documentation
│   ├── plans.mdx
│   ├── features-comparison.mdx
│   └── billing.mdx
└── troubleshooting/         # Troubleshooting guides
    ├── common-issues.mdx
    ├── error-codes.mdx
    └── performance.mdx
```

## 🛠️ Development

### Adding New Pages

1. Create a new `.mdx` file in the appropriate directory
2. Add frontmatter with title and description:
   ```mdx
   ---
   title: 'Page Title'
   description: 'Page description for SEO'
   ---
   ```
3. Update `mint.json` navigation to include the new page

### Mintlify Components

The documentation uses various Mintlify components:

- `<Card>` - For feature highlights
- `<CardGroup>` - For grouped content
- `<Steps>` - For step-by-step guides
- `<Tabs>` - For tabbed content
- `<Callout>` - For important notices
- `<CodeGroup>` - For code examples

### Styling

- Use Tailwind CSS classes for styling
- Follow the established color scheme (purple theme)
- Maintain consistent spacing and typography

## 📚 Content Guidelines

### Writing Style

- Use clear, concise language
- Include practical examples
- Add code snippets where relevant
- Use screenshots for complex UI explanations
- Keep content up-to-date with the application

### SEO Optimization

- Use descriptive titles and descriptions
- Include relevant keywords naturally
- Structure content with proper headings
- Add meta descriptions for each page

### Accessibility

- Use descriptive alt text for images
- Ensure proper heading hierarchy
- Maintain good color contrast
- Test with screen readers

## 🔧 Configuration

### mint.json

The main configuration file includes:

- **Navigation Structure** - Organized into logical groups
- **Branding** - Colors, logos, and social links
- **SEO Settings** - Meta tags and descriptions
- **Custom Components** - Reusable UI components

### Customization

- Update colors in `mint.json` to match your brand
- Modify navigation structure as needed
- Add custom components for specific use cases
- Configure analytics and tracking

## 📖 Content Sections

### Getting Started
- Introduction to JobSpark AI
- Quick start guide
- Authentication setup
- Installation instructions

### Core Features
- AI Resume Analysis
- Job Matching
- Resume Builder
- Profile Management
- Job Tracking
- Analytics Dashboard

### User Management
- Profile Settings
- Preferences Configuration
- Security Features
- Localization Options

### API Reference
- Authentication
- Resume Analysis API
- Job Matching API
- Profile Management API
- Upload Endpoints

### Guides
- Resume Optimization
- Job Search Strategy
- Profile Completion
- Security Best Practices

### Pricing & Plans
- Plan Comparison
- Feature Details
- Billing Information

### Troubleshooting
- Common Issues
- Error Codes
- Performance Optimization

## 🚀 Deployment

### Production Deployment

1. **Build Documentation**
   ```bash
   mintlify build
   ```

2. **Deploy to Mintlify**
   ```bash
   mintlify deploy
   ```

3. **Custom Domain** (Optional)
   - Configure custom domain in Mintlify dashboard
   - Update DNS settings
   - Enable SSL certificate

### Continuous Deployment

- Connect GitHub repository to Mintlify
- Automatic deployments on push to main branch
- Preview deployments for pull requests

## 🤝 Contributing

### Content Updates

1. Create a feature branch
2. Make your changes
3. Test locally with `mintlify dev`
4. Submit a pull request
5. Review and merge

### Style Guide

- Follow existing formatting patterns
- Use consistent terminology
- Include examples and code snippets
- Test all links and references

## 📞 Support

### Documentation Issues

- Create an issue in this repository
- Tag with appropriate labels
- Provide detailed description of the problem

### Content Requests

- Submit feature requests for new documentation
- Suggest improvements to existing content
- Report outdated information

## 🔗 Links

- **Live Documentation**: [https://jobspark.ai/docs](https://jobspark.ai/docs)
- **Main Application**: [https://jobspark.ai](https://jobspark.ai)
- **GitHub Repository**: [https://github.com/jobspark-ai](https://github.com/jobspark-ai)
- **Support Email**: support@jobspark.ai

## 📄 License

This documentation is part of the JobSpark AI project and follows the same license terms.

---

**Note**: This documentation is automatically generated and deployed. For the most up-to-date information, always refer to the live documentation at [https://jobspark.ai/docs](https://jobspark.ai/docs).
