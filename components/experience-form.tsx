"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { 
  Building2, 
  Globe, 
  MapPin, 
  Calendar, 
  Briefcase, 
  X, 
  Save, 
  ExternalLink,
  Image as ImageIcon
} from "lucide-react"
import { getCompanyLogo, isValidWebsiteUrl, extractDomain } from "@/lib/company-logo"

interface Experience {
  id: string
  user_id: string
  job_title: string
  company_name: string
  company_website?: string
  company_logo_url?: string
  location?: string
  start_date?: string
  end_date?: string
  is_current_job: boolean
  years_of_experience?: number
  description?: string
  created_at: string
  updated_at: string
}

interface ExperienceFormProps {
  experience?: Experience | null
  onSave: (experienceData: Omit<Experience, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => void
  onCancel: () => void
}

export default function ExperienceForm({ experience, onSave, onCancel }: ExperienceFormProps) {
  const [formData, setFormData] = useState({
    job_title: experience?.job_title || "",
    company_name: experience?.company_name || "",
    company_website: experience?.company_website || "",
    company_logo_url: experience?.company_logo_url || "",
    location: experience?.location || "",
    start_date: experience?.start_date || "",
    end_date: experience?.end_date || "",
    is_current_job: experience?.is_current_job || false,
    years_of_experience: experience?.years_of_experience || undefined,
    description: experience?.description || ""
  })
  const [loading, setLoading] = useState(false)
  const [logoLoading, setLogoLoading] = useState(false)

  const handleInputChange = (field: string, value: string | boolean | number) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleCompanyWebsiteChange = async (website: string) => {
    handleInputChange('company_website', website)
    
    if (isValidWebsiteUrl(website)) {
      setLogoLoading(true)
      try {
        const logoUrl = await getCompanyLogo(website)
        if (logoUrl) {
          handleInputChange('company_logo_url', logoUrl)
        }
      } catch (error) {
        console.error('Error fetching company logo:', error)
      } finally {
        setLogoLoading(false)
      }
    }
  }

  const calculateYearsOfExperience = () => {
    if (formData.start_date && formData.end_date && !formData.is_current_job) {
      const start = new Date(formData.start_date)
      const end = new Date(formData.end_date)
      const years = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
      handleInputChange('years_of_experience', Math.round(years * 10) / 10)
    }
  }

  useEffect(() => {
    if (formData.start_date && formData.end_date && !formData.is_current_job) {
      calculateYearsOfExperience()
    }
  }, [formData.start_date, formData.end_date, formData.is_current_job])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await onSave({
        job_title: formData.job_title,
        company_name: formData.company_name,
        company_website: formData.company_website || undefined,
        company_logo_url: formData.company_logo_url || undefined,
        location: formData.location || undefined,
        start_date: formData.start_date || undefined,
        end_date: formData.is_current_job ? undefined : (formData.end_date || undefined),
        is_current_job: formData.is_current_job,
        years_of_experience: formData.years_of_experience,
        description: formData.description || undefined
      })
    } catch (error) {
      console.error('Error saving experience:', error)
    } finally {
      setLoading(false)
    }
  }

  const isFormValid = formData.job_title.trim() && formData.company_name.trim()

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center">
            <Briefcase className="w-5 h-5 mr-2" />
            {experience ? 'Edit Experience' : 'Add Experience'}
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Job Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Job Title *
            </label>
            <Input
              value={formData.job_title}
              onChange={(e) => handleInputChange('job_title', e.target.value)}
              placeholder="e.g., Senior Software Engineer"
              required
            />
          </div>

          {/* Company Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Company Name *
            </label>
            <Input
              value={formData.company_name}
              onChange={(e) => handleInputChange('company_name', e.target.value)}
              placeholder="e.g., Google"
              required
            />
          </div>

          {/* Company Website */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Company Website
            </label>
            <div className="flex items-center space-x-2">
              <Input
                value={formData.company_website}
                onChange={(e) => handleCompanyWebsiteChange(e.target.value)}
                placeholder="e.g., https://google.com"
                type="url"
              />
              {logoLoading && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              )}
              {formData.company_logo_url && !logoLoading && (
                <img 
                  src={formData.company_logo_url} 
                  alt="Company logo" 
                  className="w-6 h-6 rounded"
                />
              )}
            </div>
            {formData.company_website && isValidWebsiteUrl(formData.company_website) && (
              <p className="text-xs text-gray-500 mt-1">
                Domain: {extractDomain(formData.company_website)}
              </p>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Location
            </label>
            <Input
              value={formData.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
              placeholder="e.g., San Francisco, CA"
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Start Date
              </label>
              <Input
                value={formData.start_date}
                onChange={(e) => handleInputChange('start_date', e.target.value)}
                type="date"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                End Date
              </label>
              <Input
                value={formData.end_date}
                onChange={(e) => handleInputChange('end_date', e.target.value)}
                type="date"
                disabled={formData.is_current_job}
              />
            </div>
          </div>

          {/* Current Job Checkbox */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="current_job"
              checked={formData.is_current_job}
              onChange={(e) => handleInputChange('is_current_job', e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="current_job" className="text-sm text-gray-700 dark:text-gray-300">
              This is my current job
            </label>
          </div>

          {/* Years of Experience */}
          {formData.years_of_experience && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Years of Experience
              </label>
              <Input
                value={formData.years_of_experience}
                onChange={(e) => handleInputChange('years_of_experience', parseFloat(e.target.value) || 0)}
                type="number"
                step="0.1"
                min="0"
                max="50"
                placeholder="Calculated automatically"
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <Textarea
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Describe your role, responsibilities, and achievements..."
              rows={4}
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!isFormValid || loading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {loading ? 'Saving...' : 'Save Experience'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
