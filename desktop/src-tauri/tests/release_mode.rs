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

#[test]
fn shell_mode_is_trimmed_before_comparison() {
    assert!(starts_sidecar(Some(" embedded ")));
    assert!(!starts_sidecar(Some(" remote ")));
    assert!(!starts_sidecar(Some("\u{feff} remote \u{feff}")));
}

#[test]
#[ignore = "requires CORPS_SHELL_MODE=remote at compile time"]
fn remote_build_env_disables_sidecar() {
    assert!(!starts_sidecar(option_env!("CORPS_SHELL_MODE")));
}
