[CmdletBinding()]
param(
  [Parameter()]
  [string]$AgentName = "clara-ai",

  [Parameter()]
  [string]$ConversationId,

  [Parameter()]
  [ValidateRange(1, 100)]
  [int]$ConversationPageSize = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-ElevenLabsJson {
  param(
    [Parameter(Mandatory)]
    [string[]]$Arguments,

    [Parameter(Mandatory)]
    [string]$Operation
  )

  $raw = & elevenlabs @Arguments --format json 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "ElevenLabs CLI failed during '$Operation'. Review authentication, scopes, and network access."
  }

  try {
    return ($raw | ConvertFrom-Json)
  } catch {
    throw "ElevenLabs CLI returned invalid JSON during '$Operation'."
  }
}

function Get-IdSuffix {
  param([AllowNull()][string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  if ($Value.Length -le 8) {
    return $Value
  }

  return $Value.Substring($Value.Length - 8)
}

function Get-ElapsedMilliseconds {
  param($Metric)

  if ($null -eq $Metric -or $null -eq $Metric.elapsed_time) {
    return $null
  }

  return [Math]::Round(([double]$Metric.elapsed_time * 1000), 1)
}

function Get-ObjectProperty {
  param(
    $InputObject,
    [Parameter(Mandatory)]
    [string]$Name
  )

  if ($null -eq $InputObject) {
    return $null
  }

  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Get-Percentile {
  param(
    [double[]]$Values,
    [ValidateRange(0, 1)]
    [double]$Percentile
  )

  $ordered = @($Values | Where-Object { $null -ne $_ } | Sort-Object)
  if ($ordered.Count -eq 0) {
    return $null
  }

  $index = [Math]::Max(0, [Math]::Ceiling($Percentile * $ordered.Count) - 1)
  return [Math]::Round([double]$ordered[$index], 1)
}

function Get-PlaceholderNames {
  param($DynamicVariables)

  if ($null -eq $DynamicVariables -or $null -eq $DynamicVariables.dynamic_variable_placeholders) {
    return @()
  }

  $names = @()
  foreach ($placeholder in @($DynamicVariables.dynamic_variable_placeholders)) {
    if ($placeholder -is [string]) {
      $names += $placeholder
      continue
    }

    $names += @($placeholder.PSObject.Properties.Name)
  }

  return @($names | Sort-Object -Unique)
}

$versionOutput = (& elevenlabs --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "The ElevenLabs CLI is not available."
}

$agentListParams = @{
  search = $AgentName
  page_size = 100
} | ConvertTo-Json -Compress

$agentList = Invoke-ElevenLabsJson -Arguments @(
  "agents", "list", "--params", $agentListParams
) -Operation "agent lookup"

$matches = @($agentList.agents | Where-Object { $_.name -ceq $AgentName })
if ($matches.Count -ne 1) {
  throw "Expected exactly one agent named '$AgentName'; found $($matches.Count)."
}

$targetAgent = $matches[0]
$agentParams = @{ agent_id = $targetAgent.agent_id } | ConvertTo-Json -Compress
$agent = Invoke-ElevenLabsJson -Arguments @(
  "agents", "get", "--params", $agentParams
) -Operation "agent read"

$branchListParams = @{
  agent_id = $targetAgent.agent_id
  include_archived = $false
  include_commit_status = $true
  limit = 100
} | ConvertTo-Json -Compress
$branchList = Invoke-ElevenLabsJson -Arguments @(
  "agents", "branches", "list", "--params", $branchListParams
) -Operation "branch read"
$branches = @($branchList.results)

if ([string]::IsNullOrWhiteSpace($ConversationId)) {
  $conversationListParams = @{
    agent_id = $targetAgent.agent_id
    page_size = $ConversationPageSize
    sort_direction = "desc"
    summary_mode = "exclude"
  } | ConvertTo-Json -Compress

  $conversationList = Invoke-ElevenLabsJson -Arguments @(
    "agents", "conversations", "list", "--params", $conversationListParams
  ) -Operation "conversation lookup"

  $latestConversation = @(
    $conversationList.conversations |
      Where-Object { $_.status -eq "done" } |
      Sort-Object start_time_unix_secs -Descending
  ) | Select-Object -First 1

  if ($null -eq $latestConversation) {
    throw "No completed conversation was found for '$AgentName'."
  }

  $ConversationId = $latestConversation.conversation_id
}

$conversationParams = @{ conversation_id = $ConversationId } | ConvertTo-Json -Compress
$conversation = Invoke-ElevenLabsJson -Arguments @(
  "agents", "conversations", "get", "--params", $conversationParams
) -Operation "conversation read"

if ($conversation.agent_id -ne $targetAgent.agent_id) {
  throw "The requested conversation does not belong to '$AgentName'."
}

$config = $agent.conversation_config
$prompt = $config.agent.prompt
$turnConfig = $config.turn
$tts = $config.tts
$asr = $config.asr
$transcript = @($conversation.transcript | Sort-Object time_in_call_secs)

$configuredVariableNames = @(Get-PlaceholderNames $config.agent.dynamic_variables)
$receivedVariableNames = @()
if ($null -ne $conversation.conversation_initiation_client_data -and
    $null -ne $conversation.conversation_initiation_client_data.dynamic_variables) {
  $receivedVariableNames = @(
    $conversation.conversation_initiation_client_data.dynamic_variables.PSObject.Properties.Name |
      Where-Object { $_ -notlike "system__*" } |
      Sort-Object -Unique
  )
}

$turnRows = @()
$contextualUpdateCount = 0
$ragTurnCount = 0
$interruptedAgentTurns = 0
$agentResponseLengths = @()
$audioLatencyValues = @()

$turnIndex = 0
foreach ($entry in $transcript) {
  $turnIndex++
  $toolNames = @()
  foreach ($toolCall in @($entry.tool_calls)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$toolCall.tool_name)) {
      $toolNames += [string]$toolCall.tool_name
    }
  }

  $contextualUpdateCount += @($toolNames | Where-Object { $_ -eq "contextual_update" }).Count

  $ragUsed = (@($entry.used_static_kb_document_ids).Count -gt 0) -or
    ($null -ne $entry.rag_retrieval_info)
  if ($ragUsed) {
    $ragTurnCount++
  }

  $messageLength = ([string]$entry.message).Length
  if ($entry.role -eq "agent" -and $messageLength -gt 0) {
    $agentResponseLengths += $messageLength
    if ([bool]$entry.interrupted) {
      $interruptedAgentTurns++
    }
  }

  $metrics = $null
  if ($null -ne $entry.conversation_turn_metrics -and
      @($entry.conversation_turn_metrics.PSObject.Properties.Name) -contains "metrics") {
    $metrics = $entry.conversation_turn_metrics.metrics
  }

  $llmTtfbMs = $null
  $llmFirstSentenceMs = $null
  $ttsTtfbMs = $null
  $audioSinceSilenceMs = $null
  $silenceBeforeInitiationMs = $null
  if ($null -ne $metrics) {
    $llmTtfbMs = Get-ElapsedMilliseconds (Get-ObjectProperty $metrics "convai_llm_service_ttfb")
    $llmFirstSentenceMs = Get-ElapsedMilliseconds (Get-ObjectProperty $metrics "convai_llm_service_ttf_sentence")
    $ttsTtfbMs = Get-ElapsedMilliseconds (Get-ObjectProperty $metrics "convai_tts_service_ttfb")
    $audioSinceSilenceMs = Get-ElapsedMilliseconds (Get-ObjectProperty $metrics "convai_ttf_audio_since_silence")
    $silenceBeforeInitiationMs = Get-ElapsedMilliseconds (Get-ObjectProperty $metrics "convai_turn_silence_before_initiation")
  }
  if ($null -ne $audioSinceSilenceMs) {
    $audioLatencyValues += $audioSinceSilenceMs
  }

  $turnRows += [PSCustomObject]@{
    index = $turnIndex
    role = $entry.role
    time_in_call_secs = $entry.time_in_call_secs
    message_chars = $messageLength
    source_medium = $entry.source_medium
    interrupted = [bool]$entry.interrupted
    ignored_as_backchannel = [bool]$entry.ignored_as_backchannel
    llm = $entry.producing_llm
    rag_used = $ragUsed
    tool_names = @($toolNames | Sort-Object -Unique)
    latency_ms = [PSCustomObject]@{
      llm_ttfb = $llmTtfbMs
      llm_first_sentence = $llmFirstSentenceMs
      tts_ttfb = $ttsTtfbMs
      audio_since_silence = $audioSinceSilenceMs
      silence_before_initiation = $silenceBeforeInitiationMs
    }
  }
}

$knowledgeBaseCount = if ($null -ne $prompt.knowledge_base) { @($prompt.knowledge_base).Count } else { 0 }
$toolCount = if ($null -ne $prompt.tools) { @($prompt.tools).Count } else { 0 }
$evaluationCount = @($conversation.analysis.evaluation_criteria_results_list).Count

$findings = @()
if (([string]$prompt.prompt).Length -gt 6000) {
  $findings += "LONG_PROMPT"
}
if ([double]$prompt.temperature -ge 0.9) {
  $findings += "HIGH_VARIANCE_TEMPERATURE"
}
if ($evaluationCount -eq 0) {
  $findings += "NO_QUALITY_EVALUATIONS"
}
if ($configuredVariableNames.Count -gt 0 -and $receivedVariableNames.Count -eq 0) {
  $findings += "CUSTOM_DYNAMIC_VARIABLES_NOT_RECEIVED_AT_START"
}
if ($contextualUpdateCount -gt 0) {
  $findings += "CONTEXT_SENT_AS_TRANSCRIPT_PREAMBLE"
}
if ($interruptedAgentTurns -gt 0) {
  $findings += "AGENT_RESPONSE_INTERRUPTED"
}
if ($agentResponseLengths.Count -gt 0 -and ($agentResponseLengths | Measure-Object -Maximum).Maximum -gt 250) {
  $findings += "LONG_AGENT_RESPONSE"
}
if ($knowledgeBaseCount -gt 0 -and $ragTurnCount -eq 0) {
  $findings += "KNOWLEDGE_BASE_UNUSED_IN_SAMPLE"
}
if ($branches.Count -eq 1 -and $branches[0].name -eq "Main") {
  $findings += "NO_EXPERIMENT_BRANCH"
}

$report = [PSCustomObject]@{
  schema_version = 1
  observed_at_utc = [DateTimeOffset]::UtcNow.ToString("o")
  operation = "read_only_redacted_analysis"
  cli = [PSCustomObject]@{
    version = $versionOutput
    credential_capability = "agent_and_conversation_read"
  }
  target = [PSCustomObject]@{
    agent_name = $agent.name
    agent_id_suffix = Get-IdSuffix $agent.agent_id
    version_id_suffix = Get-IdSuffix $agent.version_id
    branch_id_suffix = Get-IdSuffix $agent.branch_id
    access_role = $agent.access_info.role
    branches = @(
      $branches | ForEach-Object {
        $branchIdentifier = Get-ObjectProperty $_ "branch_id"
        if ([string]::IsNullOrWhiteSpace([string]$branchIdentifier)) {
          $branchIdentifier = Get-ObjectProperty $_ "id"
        }

        [PSCustomObject]@{
          name = $_.name
          branch_id_suffix = Get-IdSuffix $branchIdentifier
          commits_ahead = Get-ObjectProperty $_ "commits_ahead"
          commits_behind = Get-ObjectProperty $_ "commits_behind"
        }
      }
    )
  }
  configuration = [PSCustomObject]@{
    language = $config.agent.language
    first_message_empty = [string]::IsNullOrWhiteSpace([string]$config.agent.first_message)
    disable_first_message_interruptions = $config.agent.disable_first_message_interruptions
    prompt_chars = ([string]$prompt.prompt).Length
    llm = $prompt.llm
    temperature = $prompt.temperature
    max_tokens = $prompt.max_tokens
    knowledge_base_count = $knowledgeBaseCount
    tool_count = $toolCount
    configured_dynamic_variable_names = $configuredVariableNames
    turn_model = $turnConfig.turn_model
    turn_eagerness = $turnConfig.turn_eagerness
    turn_timeout_secs = $turnConfig.turn_timeout
    speculative_turn = $turnConfig.speculative_turn
    asr_provider = $asr.provider
    asr_quality = $asr.quality
    asr_input_format = $asr.user_input_audio_format
    tts_model = $tts.model_id
    tts_output_format = Get-ObjectProperty $tts "output_format"
    tts_optimize_streaming_latency = $tts.optimize_streaming_latency
    tts_stability = $tts.stability
    tts_similarity_boost = $tts.similarity_boost
    tts_speed = $tts.speed
    voice_id_suffix = Get-IdSuffix $tts.voice_id
  }
  conversation = [PSCustomObject]@{
    conversation_id_suffix = Get-IdSuffix $conversation.conversation_id
    status = $conversation.status
    duration_secs = $conversation.metadata.call_duration_secs
    termination_reason = $conversation.metadata.termination_reason
    main_language = $conversation.metadata.main_language
    provider_call_success = $conversation.analysis.call_successful
    evaluation_count = $evaluationCount
    sentiment_label = $conversation.analysis.sentiment_analysis.overall_label
    warning_count = @($conversation.metadata.warnings).Count
    error_present = $null -ne $conversation.metadata.error
    received_custom_dynamic_variable_names = $receivedVariableNames
    contextual_update_count = $contextualUpdateCount
    rag_turn_count = $ragTurnCount
    interrupted_agent_turns = $interruptedAgentTurns
    agent_response_chars = [PSCustomObject]@{
      count = $agentResponseLengths.Count
      average = if ($agentResponseLengths.Count -gt 0) { [Math]::Round(($agentResponseLengths | Measure-Object -Average).Average, 1) } else { $null }
      maximum = if ($agentResponseLengths.Count -gt 0) { ($agentResponseLengths | Measure-Object -Maximum).Maximum } else { $null }
    }
    audio_since_silence_ms = [PSCustomObject]@{
      sample_size = $audioLatencyValues.Count
      p50 = Get-Percentile $audioLatencyValues 0.5
      p90 = Get-Percentile $audioLatencyValues 0.9
      note = "Small samples are directional only; use at least 30 sessions and 100 turns."
    }
    turns = $turnRows
  }
  findings = $findings
  privacy = [PSCustomObject]@{
    prompt_included = $false
    transcript_included = $false
    full_identifiers_included = $false
    customer_values_included = $false
  }
}

$report | ConvertTo-Json -Depth 12
