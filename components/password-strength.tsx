import { getPasswordStrength } from "@/lib/validation"

interface PasswordStrengthProps {
  password: string
}

export default function PasswordStrength({ password }: PasswordStrengthProps) {
  if (!password) return null

  const strength = getPasswordStrength(password)

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">Password Strength:</span>
        <span
          className={`font-medium ${
            strength.score >= 4
              ? "text-green-600"
              : strength.score >= 3
                ? "text-blue-600"
                : strength.score >= 2
                  ? "text-yellow-600"
                  : "text-red-600"
          }`}
        >
          {strength.label}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${strength.color}`}
          style={{ width: `${strength.percentage}%` }}
        />
      </div>
    </div>
  )
}
