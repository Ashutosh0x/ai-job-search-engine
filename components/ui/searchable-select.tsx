"use client"

import { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Option {
  value: string
  label: string
}

interface SearchableSelectProps {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select an option",
  disabled = false,
  className
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [filteredOptions, setFilteredOptions] = useState<Option[]>(options)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Filter options based on search query
  useEffect(() => {
    if (searchQuery.trim() === "") {
      setFilteredOptions(options)
    } else {
      const filtered = options.filter(option =>
        option.label.toLowerCase().includes(searchQuery.toLowerCase())
      )
      setFilteredOptions(filtered)
    }
  }, [searchQuery, options])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery("")
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const selectedOption = options.find(option => option.value === value)

  const handleSelect = (option: Option) => {
    onChange(option.value)
    setIsOpen(false)
    setSearchQuery("")
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange("")
    setSearchQuery("")
  }

  return (
    <div className={cn("relative", className)} ref={dropdownRef}>
      <Button
        variant="outline"
        role="combobox"
        aria-expanded={isOpen}
        className="w-full justify-between px-3 py-2 h-auto min-h-[40px]"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && (
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0 hover:bg-transparent"
              onClick={handleClear}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </div>
      </Button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-hidden">
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                No options found
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700",
                    option.value === value && "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                  )}
                  onClick={() => handleSelect(option)}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
} 