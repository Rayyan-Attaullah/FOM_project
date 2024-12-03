import React, { useState } from "react";
import axios from "axios";
import { Button, CircularProgress, Typography, Card, CardContent, Grid, Box, 
         Checkbox, FormControlLabel, Alert, List, ListItem, ListItemIcon, 
         ListItemText, Dialog, DialogTitle, DialogContent, DialogActions, 
         TextField, IconButton, Tooltip } from "@mui/material";
import { ArrowRight, ArrowDropDown, Error, CheckCircle } from '@mui/icons-material';
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { docco } from "react-syntax-highlighter/dist/esm/styles/hljs";

function FileUpload() {
  const [file, setFile] = useState(null);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState(new Set());
  const [validationResult, setValidationResult] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [showTranslationDialog, setShowTranslationDialog] = useState(false);
  const [currentConstraint, setCurrentConstraint] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    resetState();
  };

  const resetState = () => {
    setResponse(null);
    setValidationResult(null);
    setSelectedFeatures(new Set());
    setExpandedNodes(new Set());
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file");
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post("http://localhost:5000/upload", formData);
      setResponse(res.data);
      setError(null);
      handleConstraintTranslations(res.data.constraints);
    } catch (err) {
      setError(err.response?.data?.error || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleConstraintTranslations = (constraints) => {
    const untranslated = constraints.find(c => !c.translation);
    if (untranslated) {
      setCurrentConstraint(untranslated);
      setShowTranslationDialog(true);
    }
  };

  const validateSelection = async () => {
    if (!selectedFeatures.size) return;
    try {
      const res = await axios.post("http://localhost:5000/validate", {
        selectedFeatures: Array.from(selectedFeatures)
      });
      setValidationResult(res.data);
    } catch (err) {
      setError("Validation failed");
    }
  };

  const handleFeatureSelect = (feature, checked) => {
    const newSelected = new Set(selectedFeatures);
    
    if (checked) {
      newSelected.add(feature.name);
      if (feature.parent) newSelected.add(feature.parent);
      if (feature.group === "XOR") {
        feature.children?.forEach(child => {
          if (child.name !== feature.name) newSelected.delete(child.name);
        });
      }
    } else {
      newSelected.delete(feature.name);
      const deselectChildren = (f) => {
        f.children?.forEach(child => {
          newSelected.delete(child.name);
          deselectChildren(child);
        });
      };
      deselectChildren(feature);
    }
    
    setSelectedFeatures(newSelected);
    validateSelection();
  };

  const renderFeatureTree = (feature, level = 0) => {
    const isSelected = selectedFeatures.has(feature.name);
    const isDisabled = feature.group === "XOR" && feature.parent && 
                      selectedFeatures.has(feature.parent) && 
                      feature.children?.some(child => 
                        selectedFeatures.has(child.name) && child.name !== feature.name);

    return (
      <List key={feature.name} style={{ paddingLeft: level * 20 }}>
        <ListItem>
          {feature.children?.length > 0 && (
            <ListItemIcon onClick={() => toggleNode(feature.name)} style={{cursor: 'pointer'}}>
              {expandedNodes.has(feature.name) ? <ArrowDropDown /> : <ArrowRight />}
            </ListItemIcon>
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={isSelected}
                onChange={(e) => handleFeatureSelect(feature, e.target.checked)}
                disabled={isDisabled}
              />
            }
            label={
              <Tooltip title={feature.mandatory ? "Mandatory feature" : "Optional feature"}>
                <Typography
                  variant="body1"
                  style={{
                    fontWeight: feature.mandatory ? 'bold' : 'normal',
                    color: isDisabled ? '#888' : 'inherit'
                  }}
                >
                  {feature.name}{feature.mandatory ? ' *' : ''}
                </Typography>
              </Tooltip>
            }
          />
          {feature.group && (
            <Tooltip title={`${feature.group} group`}>
              <Typography variant="caption" color="textSecondary" style={{marginLeft: 8}}>
                [{feature.group}]
              </Typography>
            </Tooltip>
          )}
        </ListItem>
        {expandedNodes.has(feature.name) && feature.children?.map(child => 
          renderFeatureTree(child, level + 1)
        )}
      </List>
    );
  };

  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) newSet.delete(nodeId);
      else newSet.add(nodeId);
      return newSet;
    });
  };

  return (
    <Box sx={{ p: 4, bgcolor: "#f7f7f7", minHeight: "100vh" }}>
      <Typography variant="h4" gutterBottom>Feature Model Analysis</Typography>
      
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button variant="contained" component="label">
          Select XML File
          <input type="file" hidden accept=".xml" onChange={handleFileChange} />
        </Button>
        <Typography variant="body2">
          {file ? file.name : 'No file selected'}
        </Typography>
        <Button
          variant="contained"
          onClick={handleUpload}
          disabled={!file || loading}
        >
          {loading ? <CircularProgress size={24} /> : "Upload"}
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      
      {response && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Feature Selection
                  <Tooltip title="* indicates mandatory feature">
                    <IconButton size="small">
                      <Error fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Typography>
                {response.features.map(feature => renderFeatureTree(feature))}
                
                {validationResult && (
                  <Alert 
                    severity={validationResult.isValid ? "success" : "error"}
                    sx={{ mt: 2 }}
                    icon={validationResult.isValid ? <CheckCircle /> : <Error />}
                  >
                    <Typography variant="body2">
                      {validationResult.isValid ? 
                        "Valid configuration" : 
                        validationResult.messages.join("\n")}
                    </Typography>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>Propositional Logic Rules</Typography>
                <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                  <SyntaxHighlighter language="text" style={docco}>
                    {response.logicRules?.join('\n') || 'No rules available'}
                  </SyntaxHighlighter>
                </Box>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Minimum Working Products</Typography>
                <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
                  <SyntaxHighlighter language="text" style={docco}>
                    {response.mwps?.map((mwp, i) => 
                      `MWP ${i + 1}: ${JSON.stringify(mwp)}`
                    ).join('\n') || 'No MWPs found'}
                  </SyntaxHighlighter>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <Dialog open={showTranslationDialog} onClose={() => setShowTranslationDialog(false)}>
        <DialogTitle>Translate Constraint</DialogTitle>
        <DialogContent>
          <Typography variant="body1" gutterBottom>
            {currentConstraint?.englishStatement}
          </Typography>
          <TextField
            fullWidth
            label="Propositional Logic Translation"
            variant="outlined"
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowTranslationDialog(false)}>Skip</Button>
          <Button variant="contained" onClick={() => setShowTranslationDialog(false)}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default FileUpload;