"""Domain errors for enemy threat analysis."""


class EnemyThreatAnalysisError(Exception):
    """Base class for expected algorithm errors."""


class AnalysisInputError(EnemyThreatAnalysisError):
    """Raised when user input files or options are invalid."""


class LLMConfigurationError(EnemyThreatAnalysisError):
    """Raised when the LLM endpoint is not configured."""


class LLMExtractionError(EnemyThreatAnalysisError):
    """Raised when the LLM response cannot be parsed as extraction JSON."""
