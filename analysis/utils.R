# Small helpers shared by the R scripts

# Writes R lists and data frames as JSON with base R, so no package is needed
to_json <- function(x, indent = "") {
  nxt <- paste0(indent, "  ")
  if (is.data.frame(x)) x <- lapply(seq_len(nrow(x)), function(i) as.list(x[i, , drop = FALSE]))
  if (is.list(x)) {
    if (!is.null(names(x)) && all(names(x) != "")) {
      items <- mapply(function(k, v) paste0(nxt, '"', k, '": ', to_json(v, nxt)), names(x), x)
      return(paste0("{\n", paste(items, collapse = ",\n"), "\n", indent, "}"))
    }
    return(paste0("[\n", paste(paste0(nxt, sapply(x, to_json, indent = nxt)), collapse = ",\n"), "\n", indent, "]"))
  }
  if (length(x) > 1) return(to_json(as.list(x), indent))
  if (is.null(x) || length(x) == 0 || is.na(x)) return("null")
  if (is.numeric(x)) return(format(unname(x), scientific = FALSE, trim = TRUE))
  if (is.logical(x)) return(tolower(as.character(x)))
  paste0('"', gsub('"', '\\\\"', as.character(x)), '"')
}
