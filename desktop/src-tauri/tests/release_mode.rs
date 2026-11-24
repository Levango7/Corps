use corps_desktop_lib::starts_sidecar;

#[test]
fn embedded_mode_requires_sidecar() {
    assert!(starts_sidecar(None));
    assert!(starts_sidecar(Some("embedded")));
}

#[test]
fn remote_mode_disables_sidecar() {
    assert!(!starts_sidecar(Some("remote")));
}
